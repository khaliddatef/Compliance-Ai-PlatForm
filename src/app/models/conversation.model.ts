import { Message } from './message.model';

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}
