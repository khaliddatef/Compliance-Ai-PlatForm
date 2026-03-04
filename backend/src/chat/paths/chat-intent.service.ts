import { Injectable } from '@nestjs/common';
import type { ChatPath, ConversationState } from './chat-path.types';

@Injectable()
export class ChatIntentService {
  resolveReplyLanguage(language: 'ar' | 'en' | undefined, prompt: string): 'ar' | 'en' {
    if (language === 'ar' || language === 'en') return language;
    return /[\u0600-\u06FF]/.test(String(prompt || '')) ? 'ar' : 'en';
  }

  isAcknowledgePrompt(input: string) {
    const normalized = this.normalizeIntentText(input);
    if (!normalized) return false;
    return /^(ok|okay|okey|yes|yeah|yep|sure|go ahead|continue|sounds good|fine|ah|aha|ايوه|اه|اها|تمام|ماشي|كمل|اكمل|طيب|حلو|تمام كده)$/.test(
      normalized,
    );
  }

  isTestComponentsPrompt(prompt: string) {
    const value = String(prompt || '').trim();
    if (!value) return false;
    return /(test components?|testing components?|components of control|control components|عناصر الاختبار|مكونات الاختبار|بنود الاختبار|اختبارات الكنترول|مكونات الكنترول)/i.test(
      value,
    );
  }

  isOnboardingPrompt(input: string) {
    const prompt = String(input || '').trim();
    if (!prompt) return false;
    const normalized = this.normalizeIntentText(prompt);
    if (!normalized) return false;

    const exact = new Set([
      'hi',
      'hii',
      'hello',
      'helo',
      'hey',
      'hay',
      'help',
      'hlp',
      'start',
      'strt',
      'where do i start',
      'how to start',
      'what can you do',
      'who are you',
      'what are we doing here',
      'what do we do here',
      'how does this work',
      'مرحبا',
      'اهلا',
      'هلا',
      'هاي',
      'سلام',
      'السلام عليكم',
      'ازيك',
      'عامل ايه',
      'عامله ايه',
      'اي الدنيا',
      'ايه الدنيا',
      'ابدأ',
      'ابدا',
      'ابدء',
      'ابدأ ازاي',
      'ابدا ازاي',
      'نبدأ ازاي',
      'نبدا ازاي',
      'ممكن تساعدني',
      'مين انت',
      'بتعمل ايه',
      'احنا بنعمل ايه هنا',
      'فهمني',
      'مش فاهم',
    ]);
    if (exact.has(normalized)) return true;

    return /^(hi+|he+lo+|hey+|start+|help+|يا عم|طب وبعدين|عايز ابدأ|عاوز ابدا|عاوز ابدا ازاي|عاوز افهم)$/i.test(
      normalized,
    );
  }

  isActionExecutionPrompt(input: string) {
    const prompt = String(input || '').trim();
    if (!prompt) return false;
    return /(create evidence request|open evidence request|request evidence|link evidence|link this file|assign owner|create remediation|remediation task|add to audit pack|mark reviewed|run assessment|generate audit pack|convert to evidence|انشئ طلب دليل|إنشاء طلب دليل|اطلب دليل|اربط الدليل|ربط الملف|تعيين مالك|أنشئ مهمة معالجة|إنشاء مهمة معالجة|اضف للأوديت|أضف للأوديت|اعتمد كمراجَع|شغّل تقييم|شغل تقييم|توليد حزمة تدقيق)/i.test(
      prompt,
    );
  }

  isControlGuidancePrompt(input: string) {
    const prompt = String(input || '').trim();
    if (!prompt) return false;
    return /(control|controls|test component|test components|control guidance|why partial|why fail|gap|gaps|framework|iso\s?2700\d|كنترول|كنترولات|عناصر الاختبار|مكونات الاختبار|فجوة|فجوات|ليه جزئي|ليه فشل|الفريمورك|الايزو)/i.test(
      prompt,
    );
  }

  isSmallTalkPrompt(
    input: string,
    context?: {
      hasCustomerDocs?: boolean;
      lastRoute?: ChatPath | null;
      previousUserPrompt?: string;
      state?: ConversationState;
    },
  ) {
    const prompt = String(input || '').trim();
    if (!prompt) return false;

    const normalized = this.normalizeIntentText(prompt);
    const tokenCount = normalized.split(' ').filter(Boolean).length;

    const hasComplianceKeywords =
      /(control|controls|evidence|policy|compliance|audit|iso|risk|remediation|request|upload|framework|gap|gaps|soc2|soc 2|27001|dashboard|دليل|أدلة|امتثال|كنترول|تدقيق|مخاطر|سياسة|فجوات)/i.test(
        prompt,
      );
    if (hasComplianceKeywords) return false;

    const hasFileReviewIntent =
      /(have a look|take a look|look at (it|this|that)|check (it|this|that)|review (it|this|that)|analy[sz]e (it|this|that)|summari[sz]e (it|this|that)|read (it|this|that)|inspect (it|this|that)|what do you think|tell me what do you think|بص|شوف|راجع|حلل|لخص|اقر|اقرأ|إيه رأيك|ايه رايك|بص كدا|شوف كدا)/i.test(
        prompt,
      );
    if (hasFileReviewIntent) return false;

    if (
      context?.previousUserPrompt &&
      (this.isFileContextPrompt(context.previousUserPrompt)
        || this.isControlGuidancePrompt(context.previousUserPrompt)
        || this.isActionExecutionPrompt(context.previousUserPrompt))
      && tokenCount <= 5
    ) {
      return false;
    }

    if (
      context?.lastRoute
      && context.lastRoute !== 'ONBOARDING'
      && (this.isAcknowledgePrompt(prompt) || tokenCount <= 3)
    ) {
      return false;
    }

    const stripped = normalized.replace(/[!?.,;:]+/g, '').trim();
    const smallTalkSet = new Set([
      'hi',
      'hello',
      'hey',
      'yo',
      'sup',
      'hello there',
      'how are you',
      'hows it going',
      'how is it going',
      'good morning',
      'good afternoon',
      'good evening',
      'thanks',
      'thank you',
      'thx',
      'مرحبا',
      'اهلا',
      'أهلا',
      'هلا',
      'هاي',
      'السلام عليكم',
      'ازيك',
      'عامل ايه',
      'عامله ايه',
      'اخبارك',
      'اي الدنيا',
      'ايه الدنيا',
      'طب وبعدين',
      'يا عم',
    ]);
    if (smallTalkSet.has(stripped)) return true;

    const casualPatterns = [
      /^(who are you|what can you do|what are we doing here|what do we do here|how does this work|where do i start|how to start|help|start)$/i,
      /^(مين انت|بتعمل ايه|احنا بنعمل ايه هنا|إحنا بنعمل ايه هنا|نبدأ ازاي|ابدأ ازاي|ممكن تساعدني|مش فاهم|فهمني)$/i,
    ];
    if (casualPatterns.some((pattern) => pattern.test(stripped))) return true;

    if (context?.hasCustomerDocs && context?.lastRoute && context.lastRoute !== 'ONBOARDING') {
      return false;
    }

    if (tokenCount <= 7 && !/[0-9]/.test(stripped)) return true;
    return false;
  }

  isFileSummaryPrompt(input: string) {
    const prompt = String(input || '').trim();
    if (!prompt) return false;

    const wantsSummary = /(summary|summarize|tl;dr|تلخيص|لخّص|لخص)/i.test(prompt);
    if (!wantsSummary) return false;

    const mentionsFile = /(file|document|doc|policy|pdf|docx|ملف|مستند|وثيقة|سياسة)/i.test(prompt);
    if (mentionsFile) return true;

    const tokenCount = prompt.split(/\s+/).filter(Boolean).length;
    return tokenCount <= 8;
  }

  isFileContextPrompt(input: string) {
    const prompt = String(input || '').trim();
    if (!prompt) return false;
    return /(this file|this document|uploaded file|uploaded document|policy file|document file|have a look|take a look|look at (it|this|that)|check (it|this|that)|review (it|this|that)|analy[sz]e (it|this|that)|summari[sz]e (it|this|that)|read (it|this|that)|inspect (it|this|that)|what do you think|tell me what do you think|ملف|الملف|مستند|المستند|وثيقة|الوثيقة|السياسة|المرفوع|ارفع|رفعت|بص|شوف|راجع|حلل|لخص|اقر|اقرأ|إيه رأيك|ايه رايك|بص كدا|شوف كدا)/i.test(
      prompt,
    );
  }

  isShortFollowUpPrompt(input: string) {
    const prompt = String(input || '').trim();
    if (!prompt) return false;
    const tokenCount = prompt.split(/\s+/).filter(Boolean).length;
    if (tokenCount > 7) return false;
    return /(\?|؟|what|which|who|where|why|how|ok|okay|yes|yeah|yep|ah|aha|ايه|إيه|مين|فين|ازاي|إزاي|ليه|لماذا|اه|اها|ايوه|تمام|ماشي|طيب|كمل|اكمل)/i.test(
      prompt,
    );
  }

  private normalizeIntentText(value: string) {
    return String(value || '')
      .toLowerCase()
      .replace(/[ًٌٍَُِّْـ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
