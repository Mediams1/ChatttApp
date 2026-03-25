import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { User, Message } from './src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const ORIGIN = APP_URL.startsWith('http') ? APP_URL.replace(/\/$/, '') : `https://${APP_URL.replace(/\/$/, '')}`;
const RP_ID = ORIGIN.replace(/^https?:\/\//, '').split(':')[0];
const JWT_SECRET = process.env.JWT_SECRET || 'whatbenny-secret-key';

console.log(`WebAuthn Config: ORIGIN=${ORIGIN}, RP_ID=${RP_ID}`);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: 1e7, // 10MB limit for images
  });

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Simple file-based persistence
  const USERS_FILE = path.join(__dirname, 'users.json');
  const MESSAGES_FILE = path.join(__dirname, 'messages.json');

  let users: User[] = [];
  let messages: Message[] = [];

  try {
    if (fs.existsSync(USERS_FILE)) {
      users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    }
    if (fs.existsSync(MESSAGES_FILE)) {
      messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Error loading data:', err);
  }

  const saveData = () => {
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
      fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
    } catch (err) {
      console.error('Error saving data:', err);
    }
  };

  const currentChallenges: Map<string, string> = new Map();

  // --- Auth Routes ---
  app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (users.find(u => u.email === email)) {
      return res.status(400).json({ error: 'User already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser: User = {
      id: Math.random().toString(36).substr(2, 9),
      username,
      email,
      online: false,
      biometricCredentials: [],
      avatar: `https://picsum.photos/seed/${username}/200`,
    };
    // In a real app, save hashedPassword to a separate table
    (newUser as any).password = hashedPassword;
    users.push(newUser);
    saveData();
    res.json({ message: 'User registered successfully' });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    if (!user || !(await bcrypt.compare(password, (user as any).password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    res.json({ token, user });
  });

  app.get('/api/auth/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      const user = users.find(u => u.id === decoded.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json({ user });
    } catch (err) {
      res.status(401).json({ error: 'Invalid token' });
    }
  });

  // --- Profile Routes ---
  app.post('/api/user/update-profile', async (req, res) => {
    const { userId, avatar, username } = req.body;
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (avatar) user.avatar = avatar;
    if (username) user.username = username;

    saveData();
    res.json({ message: 'Profile updated successfully', user });
  });

  // --- WebAuthn (Biometrics) Routes ---
  app.post('/api/auth/biometric/register-options', async (req, res) => {
    const { userId } = req.body;
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const options = await generateRegistrationOptions({
      rpName: 'Whatbenny',
      rpID: RP_ID,
      userID: Buffer.from(user.id),
      userName: user.email,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        // Removing platform attachment requirement to increase compatibility
        // but still preferring it if available
      },
    });

    currentChallenges.set(user.id, options.challenge);
    res.json(options);
  });

  app.post('/api/auth/biometric/register-verify', async (req, res) => {
    const { userId, body } = req.body;
    const user = users.find(u => u.id === userId);
    const expectedChallenge = currentChallenges.get(userId);

    if (!user || !expectedChallenge) return res.status(400).json({ error: 'Invalid session' });

    try {
      const verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: [ORIGIN, `${ORIGIN}/`], // Allow both with and without trailing slash
        expectedRPID: RP_ID,
      });

      if (verification.verified && verification.registrationInfo) {
        const { credential } = verification.registrationInfo;
        user.biometricCredentials?.push({
          credentialID: Buffer.from(credential.id).toString('base64url'),
          credentialPublicKey: Buffer.from(credential.publicKey).toString('base64url'),
          counter: credential.counter,
          transports: body.response.transports,
        });
        currentChallenges.delete(userId);
        saveData();
        res.json({ verified: true });
      } else {
        res.status(400).json({ verified: false });
      }
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/auth/biometric/login-options', async (req, res) => {
    const { email } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: user.biometricCredentials?.map(cred => ({
        id: cred.credentialID,
        type: 'public-key',
        transports: cred.transports,
      })),
      userVerification: 'preferred',
    });

    currentChallenges.set(user.id, options.challenge);
    res.json(options);
  });

  app.post('/api/auth/biometric/login-verify', async (req, res) => {
    const { email, body } = req.body;
    const user = users.find(u => u.email === email);
    const expectedChallenge = currentChallenges.get(user?.id || '');

    if (!user || !expectedChallenge) return res.status(400).json({ error: 'Invalid session' });

    try {
      const credential = user.biometricCredentials?.find(c => c.credentialID === body.id);
      if (!credential) throw new Error('Credential not found');

      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: [ORIGIN, `${ORIGIN}/`],
        expectedRPID: RP_ID,
        credential: {
          id: credential.credentialID,
          publicKey: Buffer.from(credential.credentialPublicKey, 'base64url'),
          counter: credential.counter,
        },
      });

      if (verification.verified) {
        const token = jwt.sign({ userId: user.id }, JWT_SECRET);
        res.json({ verified: true, token, user });
      } else {
        res.status(400).json({ verified: false });
      }
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // --- User & Message Routes ---
  app.get('/api/users', (req, res) => {
    res.json(users.map(({ id, username, email, online, avatar }) => ({ id, username, email, online, avatar })));
  });

  app.get('/api/messages/:userId/:otherId', (req, res) => {
    const { userId, otherId } = req.params;
    const filtered = messages.filter(m => 
      (m.senderId === userId && m.receiverId === otherId) || 
      (m.senderId === otherId && m.receiverId === userId)
    );
    res.json(filtered);
  });

  // --- Socket.io Real-time Logic ---
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join', (userId) => {
      socket.join(userId);
      const user = users.find(u => u.id === userId);
      if (user) {
        user.online = true;
        io.emit('user_status', { userId, online: true });
      }
    });

    socket.on('send_message', (data: Message) => {
      messages.push(data);
      saveData();
      io.to(data.receiverId).emit('receive_message', data);
      io.to(data.senderId).emit('message_sent', data);
    });

    socket.on('disconnect', () => {
      // Handle offline status
    });
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
