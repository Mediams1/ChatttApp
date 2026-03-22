import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { 
  MessageSquare, 
  Search, 
  Plus, 
  Send, 
  User as UserIcon, 
  LogOut, 
  Fingerprint, 
  Bell,
  CheckCheck,
  MoreVertical,
  Camera,
  Bot,
  Image as ImageIcon,
  Settings,
  X,
  Upload
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { User, Message, Conversation } from './types';

const SOCKET_URL = window.location.origin;

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showUserModal, setShowUserModal] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileUsername, setProfileUsername] = useState('');
  const [profileAvatar, setProfileAvatar] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      fetch('/api/users')
        .then(res => res.json())
        .then(data => setAllUsers(data));
    }
  }, [user]);

  useEffect(() => {
    if (user && activeConversation) {
      fetch(`/api/messages/${user.id}/${activeConversation.id}`)
        .then(res => res.json())
        .then(data => setMessages(data));
    }
  }, [user, activeConversation]);

  useEffect(() => {
    // Check for biometric availability
    if (window.PublicKeyCredential) {
      setIsBiometricAvailable(true);
    }

    // Request notification permission
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (user && token) {
      const newSocket = io(SOCKET_URL);
      setSocket(newSocket);
      newSocket.emit('join', user.id);

      newSocket.on('receive_message', (msg: Message) => {
        setMessages(prev => [...prev, msg]);
        showNotification(msg);
      });

      newSocket.on('message_sent', (msg: Message) => {
        setMessages(prev => [...prev, msg]);
      });

      return () => {
        newSocket.disconnect();
      };
    }
  }, [user, token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (user) {
      setProfileUsername(user.username);
      setProfileAvatar(user.avatar || '');
    }
  }, [user]);

  const showNotification = (msg: Message) => {
    if (Notification.permission === 'granted') {
      const sender = allUsers.find(u => u.id === msg.senderId);
      new Notification(`Nuevo mensaje de ${sender?.username || 'Usuario'}`, {
        body: msg.content,
        icon: sender?.avatar || '/favicon.ico'
      });
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.token) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('token', data.token);
      } else {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      });
      const data = await res.json();
      if (data.message) {
        setIsLogin(true);
        alert('Registro exitoso. Ahora puedes iniciar sesión.');
      } else {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleBiometricLogin = async () => {
    try {
      const resOptions = await fetch('/api/auth/biometric/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const options = await resOptions.json();
      
      const authRes = await startAuthentication(options);
      
      const resVerify = await fetch('/api/auth/biometric/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, body: authRes })
      });
      const data = await resVerify.json();
      
      if (data.verified) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('token', data.token);
      }
    } catch (err) {
      console.error(err);
      alert('Error en biometría. Asegúrate de haber registrado tu huella/FaceID primero.');
    }
  };

  const handleRegisterBiometric = async () => {
    if (!user) return;
    try {
      const resOptions = await fetch('/api/auth/biometric/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      });
      const options = await resOptions.json();
      
      const regRes = await startRegistration(options);
      
      const resVerify = await fetch('/api/auth/biometric/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, body: regRes })
      });
      const data = await resVerify.json();
      
      if (data.verified) {
        alert('Biometría registrada con éxito.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const sendMessage = (image?: string) => {
    if ((!newMessage.trim() && !image) || !activeConversation || !user || !socket) return;
    const msg: Message = {
      id: Math.random().toString(36).substr(2, 9),
      senderId: user.id,
      receiverId: activeConversation.id,
      content: newMessage,
      image: image,
      timestamp: new Date().toISOString(),
      read: false
    };
    socket.emit('send_message', msg);
    setNewMessage('');
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isAvatar = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('La imagen es demasiado grande (máx 5MB)');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      if (isAvatar) {
        setProfileAvatar(base64);
      } else {
        sendMessage(base64);
      }
    };
    reader.readAsDataURL(file);
  };

  const updateProfile = async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/user/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          username: profileUsername,
          avatar: profileAvatar
        })
      });
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
        setShowProfileModal(false);
        alert('Perfil actualizado');
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#0f0c1d] relative overflow-hidden">
        {/* Background elements */}
        <div className="absolute top-0 left-0 w-full h-full opacity-20 pointer-events-none">
          <div className="absolute top-10 left-10 w-4 h-4 bg-yellow-500 rounded-full blur-sm animate-pulse" />
          <div className="absolute top-20 right-20 w-4 h-4 bg-purple-500 rounded-full blur-sm animate-pulse" />
          <div className="absolute bottom-40 left-1/4 w-32 h-32 bg-purple-900/30 rounded-full blur-3xl" />
          <div className="absolute top-1/4 right-1/4 w-48 h-48 bg-blue-900/20 rounded-full blur-3xl" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#1a162e] border border-white/5 rounded-3xl p-8 shadow-2xl relative z-10"
        >
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-tr from-purple-500 to-blue-500 rounded-full mx-auto mb-4 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <MessageSquare className="text-white w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-widest">WHATBENNY</h1>
            <p className="text-gray-400 text-sm">{isLogin ? 'Iniciar sesión' : 'Crear cuenta'}</p>
          </div>

          <form onSubmit={isLogin ? handleLogin : handleRegister} className="space-y-4">
            {!isLogin && (
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                <input 
                  type="text" 
                  placeholder="Nombre de usuario"
                  className="w-full bg-[#120f24] border border-white/5 rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-purple-500 transition-colors"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="relative">
              <Bell className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
              <input 
                type="email" 
                placeholder="Correo electrónico"
                className="w-full bg-[#120f24] border border-white/5 rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-purple-500 transition-colors"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="relative">
              <Fingerprint className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
              <input 
                type="password" 
                placeholder="Contraseña"
                className="w-full bg-[#120f24] border border-white/5 rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-purple-500 transition-colors"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>

            {isLogin && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <input type="checkbox" className="rounded bg-[#120f24] border-white/5" />
                <span>Mantenerme conectado</span>
              </div>
            )}

            <button 
              type="submit"
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold py-3 rounded-xl shadow-lg shadow-purple-600/20 hover:opacity-90 transition-opacity"
            >
              {isLogin ? 'LOGIN' : 'REGISTRARSE'}
            </button>
          </form>

          {isLogin && isBiometricAvailable && (
            <div className="mt-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="h-px flex-1 bg-white/5" />
                <span className="text-xs text-gray-500 uppercase tracking-widest">O usa biometría</span>
                <div className="h-px flex-1 bg-white/5" />
              </div>
              <button 
                onClick={handleBiometricLogin}
                className="w-full flex items-center justify-center gap-3 bg-white/5 border border-white/10 py-3 rounded-xl hover:bg-white/10 transition-colors"
              >
                <Fingerprint className="w-5 h-5 text-blue-400" />
                <span className="text-sm">Face ID / Huella</span>
              </button>
            </div>
          )}

          <div className="mt-8 text-center text-sm">
            <p className="text-gray-400">
              {isLogin ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
              <button 
                onClick={() => setIsLogin(!isLogin)}
                className="text-purple-400 font-bold ml-1 hover:underline"
              >
                {isLogin ? 'Regístrate aquí' : 'Inicia sesión'}
              </button>
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0f0c1d]">
      {/* Sidebar Nav */}
      <div className="w-20 border-r border-white/5 flex flex-col items-center py-6 gap-8">
        <div className="w-12 h-12 bg-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-600/20">
          <MessageSquare className="text-white w-6 h-6" />
        </div>
        <div className="flex-1 flex flex-col gap-6">
          <button className="p-3 text-purple-500 bg-purple-500/10 rounded-xl">
            <MessageSquare className="w-6 h-6" />
          </button>
          <button className="p-3 text-gray-500 hover:text-white transition-colors">
            <Plus className="w-6 h-6" />
          </button>
          <button className="p-3 text-gray-500 hover:text-white transition-colors">
            <Bot className="w-6 h-6" />
          </button>
        </div>
        <div className="flex flex-col gap-4">
          <button 
            onClick={() => setShowProfileModal(true)}
            title="Ajustes de Perfil"
            className="p-3 text-gray-500 hover:text-purple-400 transition-colors"
          >
            <Settings className="w-6 h-6" />
          </button>
          <button 
            onClick={() => { setUser(null); localStorage.removeItem('token'); }}
            className="p-3 text-gray-500 hover:text-red-400 transition-colors"
          >
            <LogOut className="w-6 h-6" />
          </button>
          <div 
            onClick={() => setShowProfileModal(true)}
            className="w-10 h-10 rounded-full bg-gradient-to-tr from-orange-400 to-pink-500 flex items-center justify-center text-white font-bold text-sm cursor-pointer overflow-hidden border-2 border-white/10"
          >
            {user.avatar ? (
              <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              user.username[0].toUpperCase()
            )}
          </div>
        </div>
      </div>

      {/* Conversations List */}
      <div className="w-80 border-r border-white/5 flex flex-col">
        <div className="p-6 flex items-center justify-between">
          <h2 className="text-xl font-bold">Mensajes</h2>
          <button 
            onClick={() => setShowUserModal(true)}
            className="w-8 h-8 bg-pink-500 rounded-lg flex items-center justify-center hover:bg-pink-600 transition-colors"
          >
            <Plus className="text-white w-5 h-5" />
          </button>
        </div>
        <div className="px-6 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Buscar conversación..."
              className="w-full bg-white/5 border border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
              {allUsers.filter(u => u.id !== user.id).map(u => (
                <button 
                  key={u.id}
                  onClick={() => setActiveConversation(u)}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-colors ${activeConversation?.id === u.id ? 'bg-white/5' : 'hover:bg-white/5'}`}
                >
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold overflow-hidden border-2 border-white/5">
                      {u.avatar ? (
                        <img src={u.avatar} alt={u.username} className="w-full h-full object-cover" />
                      ) : (
                        u.username[0].toUpperCase()
                      )}
                    </div>
                    {u.online && <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[#0f0c1d] rounded-full" />}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-medium">{u.username}</span>
                      <span className="text-[10px] text-gray-500">Ahora</span>
                    </div>
                    <p className="text-xs text-gray-400 truncate">Inicia la conversación</p>
                  </div>
                </button>
              ))}
        </div>
      </div>

      {/* Chat Window */}
      <div className="flex-1 flex flex-col">
        {activeConversation ? (
          <>
            <div className="h-20 border-b border-white/5 flex items-center justify-between px-8 bg-white/2">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold overflow-hidden border-2 border-white/5">
                  {activeConversation.avatar ? (
                    <img src={activeConversation.avatar} alt={activeConversation.username} className="w-full h-full object-cover" />
                  ) : (
                    activeConversation.username[0].toUpperCase()
                  )}
                </div>
                <div>
                  <h3 className="font-bold">{activeConversation.username}</h3>
                  <p className="text-xs text-green-500">En línea</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-gray-500">
                <Search className="w-5 h-5 cursor-pointer hover:text-white" />
                <MoreVertical className="w-5 h-5 cursor-pointer hover:text-white" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              <div className="flex justify-center">
                <span className="bg-white/5 text-[10px] text-gray-500 px-3 py-1 rounded-full uppercase tracking-widest">Hoy</span>
              </div>
              {messages.filter(m => 
                (m.senderId === user.id && m.receiverId === activeConversation.id) || 
                (m.senderId === activeConversation.id && m.receiverId === user.id)
              ).map(m => (
                <div key={m.id} className={`flex ${m.senderId === user.id ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] p-4 rounded-2xl relative ${m.senderId === user.id ? 'bg-purple-600 text-white rounded-tr-none shadow-lg shadow-purple-600/20' : 'bg-white/5 text-white rounded-tl-none border border-white/5'}`}>
                    {m.image && (
                      <img 
                        src={m.image} 
                        alt="Shared" 
                        className="rounded-xl mb-2 max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => window.open(m.image, '_blank')}
                      />
                    )}
                    {m.content && <p className="text-sm leading-relaxed">{m.content}</p>}
                    <div className="flex items-center justify-end gap-1 mt-2">
                      <span className="text-[9px] opacity-60">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {m.senderId === user.id && <CheckCheck className="w-3 h-3 text-white/70" />}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-8">
              <div className="bg-white/5 border border-white/5 rounded-2xl p-2 flex items-center gap-2 shadow-inner">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleImageUpload}
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="p-3 text-gray-500 hover:text-purple-400 transition-colors bg-white/5 rounded-xl"
                >
                  <ImageIcon className="w-5 h-5" />
                </button>
                <input 
                  type="text" 
                  placeholder="Escribe un mensaje..."
                  className="flex-1 bg-transparent border-none focus:outline-none text-sm px-3 py-2"
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && sendMessage()}
                />
                <button 
                  onClick={() => sendMessage()}
                  className="w-12 h-12 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl flex items-center justify-center hover:opacity-90 transition-opacity shadow-lg shadow-purple-600/20"
                >
                  <Send className="text-white w-5 h-5" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
              <MessageSquare className="text-gray-600 w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Whatbenny</h2>
            <p className="text-gray-500 max-w-xs">Selecciona una conversación o toca + para iniciar una nueva.</p>
          </div>
        )}
      </div>

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfileModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[60] p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-[#1a162e] border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl"
            >
              <div className="p-8 flex items-center justify-between border-b border-white/5">
                <h3 className="text-xl font-bold tracking-tight">Mi Perfil</h3>
                <button onClick={() => setShowProfileModal(false)} className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-full hover:bg-white/10 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-8 space-y-8">
                <div className="flex flex-col items-center">
                  <div className="relative group">
                    <div className="w-32 h-32 rounded-full bg-gradient-to-tr from-purple-500 to-blue-500 p-1">
                      <div className="w-full h-full rounded-full bg-[#1a162e] overflow-hidden flex items-center justify-center border-4 border-[#1a162e]">
                        {profileAvatar ? (
                          <img src={profileAvatar} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                          <UserIcon className="w-12 h-12 text-gray-600" />
                        )}
                      </div>
                    </div>
                    <input 
                      type="file" 
                      ref={avatarInputRef} 
                      className="hidden" 
                      accept="image/*" 
                      onChange={(e) => handleImageUpload(e, true)}
                    />
                    <button 
                      onClick={() => avatarInputRef.current?.click()}
                      className="absolute bottom-0 right-0 w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center border-4 border-[#1a162e] hover:bg-purple-500 transition-colors shadow-lg"
                    >
                      <Camera className="w-4 h-4 text-white" />
                    </button>
                  </div>
                  <p className="mt-4 text-sm text-gray-400">Toca la cámara para cambiar foto</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-widest mb-2 block">Nombre de usuario</label>
                    <input 
                      type="text" 
                      className="w-full bg-[#120f24] border border-white/5 rounded-2xl py-4 px-6 focus:outline-none focus:border-purple-500 transition-colors"
                      value={profileUsername}
                      onChange={e => setProfileUsername(e.target.value)}
                    />
                  </div>

                  <div className="pt-4">
                    <label className="text-xs text-gray-500 uppercase tracking-widest mb-4 block">Seguridad</label>
                    <button 
                      onClick={handleRegisterBiometric}
                      className="w-full flex items-center justify-between bg-white/5 border border-white/5 p-5 rounded-2xl hover:bg-white/10 transition-colors group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center">
                          <Fingerprint className="w-5 h-5 text-blue-400" />
                        </div>
                        <div className="text-left">
                          <p className="font-medium text-sm">Face ID / Huella</p>
                          <p className="text-[10px] text-gray-500">Configura el acceso biométrico</p>
                        </div>
                      </div>
                      <Plus className="w-5 h-5 text-gray-500 group-hover:text-white transition-colors" />
                    </button>
                  </div>
                </div>

                <button 
                  onClick={updateProfile}
                  className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold py-4 rounded-2xl shadow-xl shadow-purple-600/20 hover:opacity-90 transition-opacity"
                >
                  GUARDAR CAMBIOS
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* User Modal */}
      <AnimatePresence>
        {showUserModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm bg-[#1a162e] border border-white/5 rounded-3xl overflow-hidden"
            >
              <div className="p-6 flex items-center justify-between border-b border-white/5">
                <h3 className="font-bold">Nueva conversación</h3>
                <button onClick={() => setShowUserModal(false)} className="text-gray-500 hover:text-white">
                  <Plus className="w-6 h-6 rotate-45" />
                </button>
              </div>
              <div className="max-h-96 overflow-y-auto p-2">
                {allUsers.filter(u => u.id !== user.id).map(u => (
                  <button 
                    key={u.id}
                    onClick={() => { setActiveConversation(u); setShowUserModal(false); }}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl hover:bg-white/5 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold">
                      {u.username[0].toUpperCase()}
                    </div>
                    <div className="text-left">
                      <p className="font-medium">{u.username}</p>
                      <p className="text-[10px] text-green-500 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                        En línea
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
