export type ChatPath =
  | 'ONBOARDING'
  | 'GENERAL_QA'
  | 'FILE_ANALYSIS'
  | 'CONTROL_GUIDANCE'
  | 'ACTION_EXECUTION';

export type OnboardingPathChoice =
  | 'GENERAL_QA'
  | 'CONTROL_GUIDANCE'
  | 'FILE_ANALYSIS'
  | 'ACTION_EXECUTION';

export type OnboardingPendingQuestion =
  | 'PATH'
  | 'TOPIC'
  | 'CONTROL_ID'
  | 'FILE_TARGET'
  | 'ACTION_TYPE'
  | 'NONE';

export type OnboardingMemory = {
  stage: 'WELCOME' | 'DISCOVERY' | 'PATH_SELECTED' | 'READY';
  preferredPath?: OnboardingPathChoice | null;
  pendingQuestion?: OnboardingPendingQuestion | null;
  lastPrompt?: string | null;
};

export type ChatToneProfile =
  | 'DEFAULT'
  | 'EGYPTIAN_CASUAL'
  | 'ARABIC_FORMAL'
  | 'ENGLISH_NEUTRAL';

export type ChatRouteDecision = {
  path: ChatPath;
  confidence: number;
  reasons: string[];
  candidates?: Array<{ path: ChatPath; score: number }>;
  mode?: 'rule' | 'hybrid';
};

export type ConversationState =
  | 'NEW'
  | 'ONBOARDED'
  | 'ACTIVE_TASK'
  | 'ACTION_MODE';

export type ChatContextMemory = {
  currentGoal?: string | null;
  framework?: string | null;
  currentControlId?: string | null;
  currentDocumentId?: string | null;
  currentDocumentName?: string | null;
  controlId?: string | null;
  mentionedDocs?: string[];
  language?: 'ar' | 'en';
  toneProfile?: ChatToneProfile;
  lastAction?: string | null;
  lastRoute?: ChatPath | null;
  onboarding?: OnboardingMemory | null;
  updatedAt?: string;
};

export type ChatRouteMeta = {
  state: ConversationState;
  route: ChatPath;
  confidence: number;
  confidenceBand?: 'LOW' | 'MEDIUM' | 'HIGH';
  memory: ChatContextMemory;
};
