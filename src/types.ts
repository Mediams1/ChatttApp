export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  online: boolean;
  lastSeen?: string;
  biometrics?: {
    faceIdEnabled: boolean;
    fingerprintEnabled: boolean;
    secret?: string;
    faceDescriptor?: number[]; // 128-dimensional vector
  };
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  image?: string; // Base64 image
  file?: string; // Base64 file
  fileName?: string;
  fileType?: string;
  timestamp: string;
  read: boolean;
}

export interface Conversation {
  id: string;
  participants: string[];
  lastMessage?: Message;
  unreadCount: number;
}
