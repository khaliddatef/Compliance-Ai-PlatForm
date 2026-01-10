export type MessageRole = 'user' | 'assistant';
export type MessageKind = 'text' | 'action';

export type MessageActionId = 'save' | 'partial' | 'fix' | 'skip';

export type MessageAction = {
  id: MessageActionId;
  label: string;
};

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  kind?: MessageKind;
  actions?: MessageAction[];
}
