import { Injectable } from '@nestjs/common';
import type { ConversationState, ChatPath } from './chat-path.types';

@Injectable()
export class ChatConversationStateService {
  resolve(params: {
    userMessageCount: number;
    assistantMessageCount: number;
    hasCustomerDocs: boolean;
    lastRoute?: ChatPath | null;
  }): ConversationState {
    const { userMessageCount, assistantMessageCount, hasCustomerDocs, lastRoute } = params;

    if (lastRoute === 'ACTION_EXECUTION') return 'ACTION_MODE';
    if (assistantMessageCount === 0 || userMessageCount <= 1) return 'NEW';
    if (lastRoute === 'ONBOARDING') return 'ONBOARDED';
    if (hasCustomerDocs) return 'ACTIVE_TASK';
    if (lastRoute === 'FILE_ANALYSIS' || lastRoute === 'CONTROL_GUIDANCE' || lastRoute === 'GENERAL_QA') {
      return 'ACTIVE_TASK';
    }
    return 'ONBOARDED';
  }
}
