import { Injectable } from '@nestjs/common';
import type { ChatRouteDecision, ChatToneProfile, ConversationState } from './chat-path.types';
import { ChatIntentService } from './chat-intent.service';

@Injectable()
export class ChatResponseGuardService {
  constructor(private readonly intent: ChatIntentService) {}

  shouldAskClarification(params: {
    decision: ChatRouteDecision;
    prompt: string;
    state: ConversationState;
  }) {
    const { decision, prompt } = params;
    if (this.intent.isAcknowledgePrompt(prompt) && decision.path !== 'ONBOARDING') {
      return false;
    }
    const candidates = decision.candidates || [];
    const ambiguity =
      candidates.length >= 2 ? Math.abs(candidates[0].score - candidates[1].score) : 1;
    const veryShort = String(prompt || '').trim().split(/\s+/).filter(Boolean).length <= 2;

    if (decision.confidence < 0.56) return true;
    if (ambiguity <= 0.12 && veryShort) return true;
    return false;
  }

  buildClarificationQuestion(params: {
    prompt: string;
    language?: 'ar' | 'en';
    toneProfile?: ChatToneProfile;
  }) {
    const language = this.intent.resolveReplyLanguage(params.language, params.prompt);
    const wantsFormalArabic = params.toneProfile === 'ARABIC_FORMAL';
    if (language === 'ar') {
      if (wantsFormalArabic) {
        return 'في أي مسار تريد أن نكمل؟ 1) تحليل ملف مرفوع 2) شرح كنترول/اختبار 3) تنفيذ إجراء (طلب دليل/ربط/معالجة).';
      }
      return 'عايز نمشي في أنهي اتجاه؟ 1) تحليل ملف مرفوع 2) شرح كنترول/اختبار 3) تنفيذ إجراء (طلب دليل/ربط/معالجة).';
    }
    return 'Which path do you want exactly? 1) uploaded-file analysis 2) control/test-component guidance 3) action execution (request/link/remediation).';
  }

  dedupeAssistantReply(params: {
    reply: string;
    previousAssistantReply?: string | null;
    language?: 'ar' | 'en';
    toneProfile?: ChatToneProfile;
  }) {
    const reply = String(params.reply || '').trim();
    const prev = String(params.previousAssistantReply || '').trim();
    if (!reply || !prev) return reply;

    const similarity = this.jaccardSimilarity(this.normalize(reply), this.normalize(prev));
    const language = this.intent.resolveReplyLanguage(params.language, reply);

    if (similarity < 0.9) return reply;
    const wantsFormalArabic = params.toneProfile === 'ARABIC_FORMAL';
    if (language === 'ar') {
      if (wantsFormalArabic) {
        return 'مفهوم. للتوضيح بشكل أدق: هل تريد تحليل ملف، شرح كنترول، أم تنفيذ إجراء؟ وسأكمل مباشرة بدون تكرار.';
      }
      return 'فاهمك. خلّيني أقولها بشكل أبسط: قولي عايز تحليل ملف، شرح كنترول، ولا تنفيذ إجراء، وأنا هكمل فورًا من غير تكرار.';
    }
    return 'Understood. Let me rephrase: tell me if you want file analysis, control guidance, or action execution, and I will continue directly without repeating.';
  }

  getConfidenceBand(confidence: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (confidence >= 0.78) return 'HIGH';
    if (confidence >= 0.58) return 'MEDIUM';
    return 'LOW';
  }

  private normalize(value: string) {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private jaccardSimilarity(a: string, b: string) {
    if (!a || !b) return 0;
    const aSet = new Set(a.split(' ').filter(Boolean));
    const bSet = new Set(b.split(' ').filter(Boolean));
    const intersection = Array.from(aSet).filter((t) => bSet.has(t)).length;
    const union = new Set([...Array.from(aSet), ...Array.from(bSet)]).size;
    if (!union) return 0;
    return intersection / union;
  }
}
