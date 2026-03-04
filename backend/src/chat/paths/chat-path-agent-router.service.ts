import { Injectable } from '@nestjs/common';
import type {
  ChatContextMemory,
  ChatPath,
  ChatRouteDecision,
  ChatToneProfile,
  ConversationState,
} from './chat-path.types';
import { ChatIntentService } from './chat-intent.service';
import { OnboardingPathHandler } from './onboarding-path.handler';
import { ActionExecutionPathHandler } from './action-execution-path.handler';

@Injectable()
export class ChatPathAgentRouterService {
  constructor(
    private readonly intent: ChatIntentService,
    private readonly onboarding: OnboardingPathHandler,
    private readonly actionExecution: ActionExecutionPathHandler,
  ) {}

  resolveEffectiveRoute(params: {
    decision: ChatRouteDecision;
    prompt: string;
    state: ConversationState;
    hasCustomerDocs: boolean;
    lastRoute?: ChatPath | null;
  }): ChatPath {
    const { decision, prompt, state, hasCustomerDocs, lastRoute } = params;

    if (
      decision.path === 'ONBOARDING' &&
      state === 'ACTIVE_TASK' &&
      !this.intent.isOnboardingPrompt(prompt)
    ) {
      return lastRoute || 'GENERAL_QA';
    }

    if (
      decision.path === 'ONBOARDING' &&
      hasCustomerDocs &&
      this.intent.isShortFollowUpPrompt(prompt) &&
      !this.intent.isOnboardingPrompt(prompt)
    ) {
      return lastRoute === 'CONTROL_GUIDANCE' ? 'CONTROL_GUIDANCE' : 'FILE_ANALYSIS';
    }

    if (
      decision.path === 'ONBOARDING' &&
      state === 'ONBOARDED' &&
      !this.intent.isOnboardingPrompt(prompt)
    ) {
      if (lastRoute && lastRoute !== 'ONBOARDING') {
        return lastRoute;
      }
      return 'GENERAL_QA';
    }

    return decision.path;
  }

  tryHandleDirectRoute(params: {
    route: ChatPath;
    prompt: string;
    language?: 'ar' | 'en';
    toneProfile?: ChatToneProfile;
    hasCustomerDocs: boolean;
    state?: ConversationState;
    memory?: ChatContextMemory;
    userName?: string | null;
  }) {
    if (params.route === 'ONBOARDING') {
      return this.onboarding.buildReply({
        prompt: params.prompt,
        language: params.language,
        toneProfile: params.toneProfile,
        hasCustomerDocs: params.hasCustomerDocs,
        state: params.state,
        memory: params.memory,
        userName: params.userName,
      });
    }
    if (params.route === 'ACTION_EXECUTION') {
      return this.actionExecution.buildReply({
        prompt: params.prompt,
        language: params.language,
        toneProfile: params.toneProfile,
      });
    }
    return null;
  }
}
