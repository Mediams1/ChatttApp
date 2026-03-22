export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  online: boolean;
  lastSeen?: string;
  biometricCredentials?: any[];
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  image?: string; // Base64 image
  timestamp: string;
  read: boolean;
}

export interface Conversation {
  id: string;
  participants: string[];
  lastMessage?: Message;
  unreadCount: number;
}
