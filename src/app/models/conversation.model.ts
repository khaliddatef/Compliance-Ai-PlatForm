import { Message } from './message.model';

export interface Conversation {
  id: string;                 // local UI id
  backendId?: string | null;   // ✅ backend conversation id
  title: string;
  messages: Message[];
  updatedAt: number;
}
