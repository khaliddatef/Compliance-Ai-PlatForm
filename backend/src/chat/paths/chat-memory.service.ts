import { Injectable } from '@nestjs/common';
import type {
  ChatContextMemory,
  OnboardingMemory,
  OnboardingPathChoice,
  OnboardingPendingQuestion,
  ChatPath,
  ChatRouteMeta,
  ChatToneProfile,
  ConversationState,
} from './chat-path.types';
import { ChatIntentService } from './chat-intent.service';

type AssistantMessageLike = {
  content?: string | null;
  sourcesJson?: unknown;
};

@Injectable()
export class ChatMemoryService {
  constructor(private readonly intent: ChatIntentService) {}

  resolveLastRouteAndMemory(messages: AssistantMessageLike[]) {
    for (const message of messages) {
      const meta = this.extractRouteMeta(message.sourcesJson);
      if (meta) {
        return {
          lastRoute: meta.route as ChatPath,
          memory: meta.memory || {},
        };
      }
    }
    return {
      lastRoute: null as ChatPath | null,
      memory: {} as ChatContextMemory,
    };
  }

  buildMemory(params: {
    previous: ChatContextMemory;
    prompt: string;
    route: ChatPath;
    language?: 'ar' | 'en';
    toneProfile?: ChatToneProfile;
    activeFramework?: string | null;
    hasCustomerDocs?: boolean;
    mentionDocumentIds?: string[];
    mentionDocuments?: Array<{ id: string; name: string }>;
  }): ChatContextMemory {
    const prompt = String(params.prompt || '').trim();
    const lang = this.intent.resolveReplyLanguage(params.language, prompt);
    const controlId = this.extractControlCodeCandidate(prompt) || params.previous.controlId || null;
    const mentionDocs = Array.isArray(params.mentionDocuments)
      ? params.mentionDocuments.filter((item) => item?.id && item?.name)
      : [];
    const currentDocumentId = mentionDocs[0]?.id || params.previous.currentDocumentId || null;
    const currentDocumentName = mentionDocs[0]?.name || params.previous.currentDocumentName || null;
    const onboarding = this.deriveOnboardingMemory({
      previous: params.previous.onboarding || null,
      prompt,
      route: params.route,
      hasCustomerDocs: !!params.hasCustomerDocs,
      hasControlId: !!controlId,
      hasCurrentDocument: !!currentDocumentId,
    });
    const currentGoal = this.deriveCurrentGoal(prompt, params.route, onboarding);
    const lastAction = params.route === 'ACTION_EXECUTION'
      ? this.deriveAction(prompt)
      : params.previous.lastAction || null;

    return {
      currentGoal: currentGoal || params.previous.currentGoal || null,
      framework: params.activeFramework || params.previous.framework || null,
      currentControlId: controlId,
      currentDocumentId,
      currentDocumentName,
      controlId,
      mentionedDocs: params.mentionDocumentIds?.length
        ? params.mentionDocumentIds
        : params.previous.mentionedDocs || [],
      language: lang,
      toneProfile: params.toneProfile || params.previous.toneProfile || 'DEFAULT',
      lastAction,
      lastRoute: params.route,
      onboarding,
      updatedAt: new Date().toISOString(),
    };
  }

  toRouteMeta(params: {
    state: ConversationState;
    route: ChatPath;
    confidence: number;
    confidenceBand?: 'LOW' | 'MEDIUM' | 'HIGH';
    memory: ChatContextMemory;
  }): ChatRouteMeta {
    return {
      state: params.state,
      route: params.route,
      confidence: params.confidence,
      confidenceBand: params.confidenceBand,
      memory: params.memory,
    };
  }

  appendRouteMetaToSources(existing: unknown, meta: ChatRouteMeta) {
    const normalized = this.normalizeSources(existing);
    normalized.push({
      objectType: 'RouteMeta',
      id: `${meta.route}:${meta.state}`,
      snippetRef: JSON.stringify(meta),
    });
    return normalized;
  }

  private extractRouteMeta(sourcesJson: unknown): ChatRouteMeta | null {
    const sources = this.normalizeSources(sourcesJson);
    for (const source of sources) {
      if (String(source?.objectType || '') !== 'RouteMeta') continue;
      const snippetRef = source?.snippetRef;
      if (typeof snippetRef !== 'string' || !snippetRef.trim()) continue;
      try {
        const parsed = JSON.parse(snippetRef) as ChatRouteMeta;
        if (parsed?.route && parsed?.state) return parsed;
      } catch {
        // ignore malformed metadata
      }
    }
    return null;
  }

  private normalizeSources(value: unknown): Array<Record<string, unknown>> {
    if (!value) return [];
    const parsed = typeof value === 'string' ? this.tryParseJson(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => !!item && typeof item === 'object') as Array<Record<string, unknown>>;
  }

  private tryParseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private deriveCurrentGoal(prompt: string, route: ChatPath, onboarding?: OnboardingMemory | null) {
    if (route === 'FILE_ANALYSIS') return 'Analyze uploaded evidence';
    if (route === 'CONTROL_GUIDANCE') return 'Understand control and test components';
    if (route === 'ACTION_EXECUTION') return 'Execute GRC action';
    if (route === 'GENERAL_QA') return prompt ? `Answer: ${prompt.slice(0, 80)}` : null;
    if (onboarding?.preferredPath === 'FILE_ANALYSIS') return 'Prepare uploaded-file analysis';
    if (onboarding?.preferredPath === 'CONTROL_GUIDANCE') return 'Prepare control guidance';
    if (onboarding?.preferredPath === 'ACTION_EXECUTION') return 'Prepare action execution';
    if (onboarding?.preferredPath === 'GENERAL_QA') return 'Prepare compliance Q&A';
    return 'Onboarding';
  }

  private extractControlCodeCandidate(prompt: string) {
    const iso = prompt.match(/\b[aA]\.\d+(?:\.\d+)*\b/);
    if (iso?.[0]) return iso[0].toUpperCase();
    const gov = prompt.match(/\b[A-Za-z]{2,}\s*-\s*\d{1,4}\b/);
    if (gov?.[0]) return gov[0].replace(/\s+/g, '').toUpperCase();
    return null;
  }

  private deriveAction(prompt: string) {
    const p = String(prompt || '').toLowerCase();
    if (/create evidence request|طلب دليل|evidence request/.test(p)) return 'CREATE_EVIDENCE_REQUEST';
    if (/link evidence|ربط الملف|اربط/.test(p)) return 'LINK_EVIDENCE_CONTROL';
    if (/remediation|مهمة معالجة/.test(p)) return 'CREATE_REMEDIATION_TASK';
    return 'ACTION_COMMAND';
  }

  private deriveOnboardingMemory(params: {
    previous: OnboardingMemory | null;
    prompt: string;
    route: ChatPath;
    hasCustomerDocs: boolean;
    hasControlId: boolean;
    hasCurrentDocument: boolean;
  }): OnboardingMemory | null {
    const previous = params.previous || {
      stage: 'WELCOME',
      preferredPath: null,
      pendingQuestion: 'PATH',
      lastPrompt: null,
    };
    const prompt = String(params.prompt || '').trim();

    if (params.route !== 'ONBOARDING') {
      if (!params.previous) return null;
      return {
        ...previous,
        stage: 'READY',
        pendingQuestion: 'NONE',
        lastPrompt: prompt || previous.lastPrompt || null,
      };
    }

    const preferredPath = this.detectOnboardingPathChoice(prompt, params.hasCustomerDocs)
      || previous.preferredPath
      || null;

    if (!preferredPath) {
      return {
        stage: this.intent.isOnboardingPrompt(prompt) ? 'WELCOME' : previous.stage || 'DISCOVERY',
        preferredPath: null,
        pendingQuestion: 'PATH',
        lastPrompt: prompt || previous.lastPrompt || null,
      };
    }

    const pendingQuestion = this.resolvePendingQuestion({
      preferredPath,
      hasCustomerDocs: params.hasCustomerDocs,
      hasControlId: params.hasControlId,
      hasCurrentDocument: params.hasCurrentDocument,
    });

    return {
      stage: pendingQuestion === 'NONE' ? 'READY' : 'PATH_SELECTED',
      preferredPath,
      pendingQuestion,
      lastPrompt: prompt || previous.lastPrompt || null,
    };
  }

  private resolvePendingQuestion(params: {
    preferredPath: OnboardingPathChoice;
    hasCustomerDocs: boolean;
    hasControlId: boolean;
    hasCurrentDocument: boolean;
  }): OnboardingPendingQuestion {
    switch (params.preferredPath) {
      case 'CONTROL_GUIDANCE':
        return params.hasControlId ? 'NONE' : 'CONTROL_ID';
      case 'FILE_ANALYSIS':
        if (!params.hasCustomerDocs || !params.hasCurrentDocument) return 'FILE_TARGET';
        return 'TOPIC';
      case 'ACTION_EXECUTION':
        return 'ACTION_TYPE';
      case 'GENERAL_QA':
      default:
        return 'TOPIC';
    }
  }

  private detectOnboardingPathChoice(
    prompt: string,
    hasCustomerDocs: boolean,
  ): OnboardingPathChoice | null {
    const value = String(prompt || '').trim();
    if (!value) return null;

    if (this.intent.isActionExecutionPrompt(value)) return 'ACTION_EXECUTION';
    if (this.intent.isTestComponentsPrompt(value) || this.intent.isControlGuidancePrompt(value)) {
      return 'CONTROL_GUIDANCE';
    }
    if (this.intent.isFileSummaryPrompt(value) || this.intent.isFileContextPrompt(value)) {
      return 'FILE_ANALYSIS';
    }

    const normalized = value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const optionMatch = normalized.match(/\b([1-4])\b/);
    if (optionMatch) {
      const selected = Number(optionMatch[1]);
      if (hasCustomerDocs) {
        if (selected === 1 || selected === 3) return 'FILE_ANALYSIS';
        if (selected === 2) return 'CONTROL_GUIDANCE';
        if (selected === 4) return 'ACTION_EXECUTION';
      } else {
        if (selected === 1) return 'GENERAL_QA';
        if (selected === 2) return 'CONTROL_GUIDANCE';
        if (selected === 3) return 'FILE_ANALYSIS';
        if (selected === 4) return 'ACTION_EXECUTION';
      }
    }

    if (/(question|سؤال|استفسار|اسال|اسأل|عايز اسال|عايز أسأل)/i.test(value)) {
      return 'GENERAL_QA';
    }
    return null;
  }
}
