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
      biometrics: {
        faceIdEnabled: false,
        fingerprintEnabled: false,
        secret: Math.random().toString(36).substr(2, 12) + Date.now().toString(36)
      },
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

  // --- Virtual Biometric Routes ---
  app.post('/api/auth/biometric/virtual-register', async (req, res) => {
    const { userId, type, faceDescriptor } = req.body;
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.biometrics) {
      user.biometrics = {
        faceIdEnabled: false,
        fingerprintEnabled: false,
        secret: Math.random().toString(36).substr(2, 12) + Date.now().toString(36)
      };
    }
    
    if (type === 'face') {
      user.biometrics.faceIdEnabled = true;
      if (faceDescriptor) {
        user.biometrics.faceDescriptor = faceDescriptor;
      }
    }
    if (type === 'fingerprint') user.biometrics.fingerprintEnabled = true;
    
    console.log(`Biometric registered for user ${user.username}: type=${type}, face=${user.biometrics.faceIdEnabled}, finger=${user.biometrics.fingerprintEnabled}, hasDescriptor=${!!user.biometrics.faceDescriptor}`);
    
    saveData();
    res.json({ verified: true, secret: user.biometrics.secret });
  });

  app.post('/api/auth/biometric/virtual-login', async (req, res) => {
    const { email, secret, type, faceDescriptor } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isEnabled = type === 'face' ? user.biometrics?.faceIdEnabled : user.biometrics?.fingerprintEnabled;
    const isSecretValid = user.biometrics?.secret === secret;

    if (!isEnabled || !isSecretValid) {
      return res.status(401).json({ verified: false, error: 'Biometría no reconocida o no habilitada' });
    }

    // Real Face Recognition Check
    if (type === 'face' && user.biometrics?.faceDescriptor) {
      if (!faceDescriptor) {
        return res.status(400).json({ verified: false, error: 'No se detectó rostro para la verificación.' });
      }

      // Euclidean distance between descriptors
      const dist = Math.sqrt(
        user.biometrics.faceDescriptor.reduce((sum, val, i) => sum + Math.pow(val - faceDescriptor[i], 2), 0)
      );

      console.log(`[AUTH] Face recognition distance for ${user.username}: ${dist.toFixed(4)} (Threshold: 0.6)`);

      // Threshold for Face Recognition (0.6 is standard for face-api.js)
      if (dist > 0.6) {
        console.log(`[AUTH] Face recognition failed for ${user.username} - Distance too high: ${dist.toFixed(4)}`);
        return res.status(401).json({ verified: false, error: 'Rostro no coincide con el registrado.' });
      }
      console.log(`[AUTH] Face recognition successful for ${user.username}`);
    }

    const jwtToken = jwt.sign({ userId: user.id }, JWT_SECRET);
    res.json({ verified: true, token: jwtToken, user });
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
