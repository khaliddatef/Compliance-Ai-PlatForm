export type MessageRole = 'user' | 'assistant';
export type MessageKind = 'text' | 'action';

export type MessageActionId = 'save' | 'partial' | 'fix' | 'skip' | 'reevaluate';

export type MessageAction = {
  id: MessageActionId;
  label: string;
  meta?: {
    documentId?: string;
  };
};

export type MessageReference =
  | {
      type: 'kb';
      controlId: string;
      title: string;
      summary?: string | null;
      evidence?: string[];
      testComponents?: string[];
      label?: string;
    }
  | {
      type: 'link';
      label: string;
      url: string;
    };

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  kind?: MessageKind;
  actions?: MessageAction[];
  reference?: MessageReference;
}
