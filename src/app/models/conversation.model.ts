import { Message } from './message.model';

export type ControlStatus = 'pending' | 'partial' | 'complete' | 'skipped';
export type CompliancePhase = 'Preparation' | 'In Progress' | 'Audit Ready';

export type ControlState = {
  started: boolean;
  intakeComplete?: boolean;
  controlPrompted?: boolean;
  currentIndex: number;
  statuses: Record<string, ControlStatus>;
  lastControlId?: string;
  greetedName?: string;
  phase: CompliancePhase;
};

export interface Conversation {
  id: string;                 // local UI id
  backendId?: string | null;   // ✅ backend conversation id
  title: string;
  messages: Message[];
  updatedAt: number;
  controlState?: ControlState;
  lastUploadIds?: string[];
  lastUploadAt?: number;
}
