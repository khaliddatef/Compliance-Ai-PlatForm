import { Injectable } from '@nestjs/common';
import { ChatIntentService } from './chat-intent.service';
import type { ChatPath, ChatRouteDecision, ConversationState } from './chat-path.types';

type ScoreBoard = Record<ChatPath, number>;

@Injectable()
export class ChatRouteClassifierService {
  constructor(private readonly intent: ChatIntentService) {}

  classify(params: {
    prompt: string;
    mentionDocumentIds: string[];
    hasCustomerDocs: boolean;
    previousUserPrompt?: string;
    lastRoute?: ChatPath | null;
    state?: ConversationState;
  }): ChatRouteDecision {
    const prompt = String(params.prompt || '').trim();
    const mentionCount = Array.isArray(params.mentionDocumentIds)
      ? params.mentionDocumentIds.length
      : 0;
    const previousUserPrompt = String(params.previousUserPrompt || '').trim();

    const scores: ScoreBoard = {
      ONBOARDING: 0,
      GENERAL_QA: 0,
      FILE_ANALYSIS: 0,
      CONTROL_GUIDANCE: 0,
      ACTION_EXECUTION: 0,
    };
    const reasons: string[] = [];

    if (!prompt) {
      return {
        path: 'GENERAL_QA',
        confidence: 0.2,
        reasons: ['Empty prompt fallback'],
        mode: 'rule',
      };
    }

    if (this.intent.isActionExecutionPrompt(prompt)) {
      scores.ACTION_EXECUTION += 1;
      reasons.push('explicit-action-keywords');
    }
    if (
      this.intent.isTestComponentsPrompt(prompt) ||
      this.intent.isControlGuidancePrompt(prompt)
    ) {
      scores.CONTROL_GUIDANCE += 0.9;
      reasons.push('control-guidance-keywords');
    }
    if (
      mentionCount > 0 ||
      this.intent.isFileSummaryPrompt(prompt) ||
      this.intent.isFileContextPrompt(prompt)
    ) {
      scores.FILE_ANALYSIS += mentionCount > 0 ? 1 : 0.78;
      reasons.push('file-context-keywords');
    }
    const explicitOnboarding = this.intent.isOnboardingPrompt(prompt);
    const isSmallTalk = this.intent.isSmallTalkPrompt(prompt, {
      hasCustomerDocs: params.hasCustomerDocs,
      lastRoute: params.lastRoute,
      previousUserPrompt,
      state: params.state,
    });
    if (explicitOnboarding) {
      scores.ONBOARDING += params.hasCustomerDocs ? 0.55 : 0.72;
      reasons.push('explicit-onboarding');
    } else if (isSmallTalk) {
      const onboardingFriendlyState =
        !params.lastRoute
        || params.lastRoute === 'ONBOARDING'
        || params.state === 'NEW'
        || params.state === 'ONBOARDED';
      if (onboardingFriendlyState) {
        scores.ONBOARDING += params.hasCustomerDocs ? 0.35 : 0.6;
        reasons.push('smalltalk-onboarding');
      } else {
        scores.GENERAL_QA += 0.3;
        reasons.push('smalltalk-active-task');
      }
    }

    if (
      params.hasCustomerDocs &&
      this.intent.isShortFollowUpPrompt(prompt) &&
      this.intent.isFileContextPrompt(previousUserPrompt)
    ) {
      scores.FILE_ANALYSIS += 0.55;
      reasons.push('short-followup-file-context');
    }

    // Follow-up resolver: preserve previous route for short ambiguous prompts.
    if (
      params.lastRoute &&
      (this.intent.isShortFollowUpPrompt(prompt) || this.intent.isAcknowledgePrompt(prompt)) &&
      !this.intent.isActionExecutionPrompt(prompt) &&
      mentionCount === 0
    ) {
      scores[params.lastRoute] += this.intent.isAcknowledgePrompt(prompt) ? 0.72 : 0.6;
      reasons.push(`followup-preserve-${params.lastRoute}`);
    }

    // Mild fallback toward GENERAL_QA when no strong signal.
    const strongest = Math.max(...Object.values(scores));
    if (strongest < 0.45) {
      scores.GENERAL_QA += 0.5;
      reasons.push('fallback-general-qa');
    }

    const ranked = (Object.entries(scores) as Array<[ChatPath, number]>)
      .sort((a, b) => b[1] - a[1])
      .map(([path, score]) => ({ path, score }));

    const winner = ranked[0];
    const second = ranked[1];
    const margin = Math.max(0, winner.score - (second?.score ?? 0));
    const confidence = this.clamp01(0.45 + winner.score * 0.35 + margin * 0.3);

    return {
      path: winner.path,
      confidence: Number(confidence.toFixed(2)),
      reasons,
      candidates: ranked.slice(0, 2),
      mode: 'hybrid',
    };
  }

  private clamp01(value: number) {
    return Math.max(0, Math.min(1, value));
  }
}
