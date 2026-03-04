export type MessageRole = 'user' | 'assistant';
export type MessageKind = 'text' | 'action';
export type MessageType = 'TEXT' | 'AI_STRUCTURED';

export type MessageActionId = 'save' | 'partial' | 'fix' | 'skip' | 'reevaluate' | string;

export type MessageAction = {
  id: MessageActionId;
  label: string;
  meta?: {
    documentId?: string;
    compactContent?: string;
    expandedContent?: string;
    uiMode?: 'collapsed' | 'expanded';
    copilotActionType?: 'CREATE_EVIDENCE_REQUEST' | 'LINK_EVIDENCE_CONTROL' | 'CREATE_REMEDIATION_TASK';
    payload?: any;
    dryRun?: boolean;
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
  messageType?: MessageType;
  actions?: MessageAction[];
  reference?: MessageReference;
  cards?: Array<{
    type: string;
    title?: string;
    status?: string;
    confidence?: number;
    scope?: string;
    lines?: string[];
    items?: Array<string | { type?: string; example?: string }>;
  }>;
  sources?: Array<{
    objectType: string;
    id: string;
    snippetRef: string | null;
  }>;
}
