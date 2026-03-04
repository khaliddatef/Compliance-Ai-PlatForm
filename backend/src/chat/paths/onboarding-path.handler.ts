import { Injectable } from '@nestjs/common';
import { ChatIntentService } from './chat-intent.service';
import type {
  ChatContextMemory,
  ChatToneProfile,
  ConversationState,
  OnboardingPathChoice,
} from './chat-path.types';

@Injectable()
export class OnboardingPathHandler {
  constructor(private readonly intent: ChatIntentService) {}

  buildReply(params: {
    prompt: string;
    language?: 'ar' | 'en';
    hasCustomerDocs: boolean;
    toneProfile?: ChatToneProfile;
    state?: ConversationState;
    memory?: ChatContextMemory;
    userName?: string | null;
  }) {
    const language = this.intent.resolveReplyLanguage(params.language, params.prompt);
    const wantsFormalArabic = params.toneProfile === 'ARABIC_FORMAL';
    const memory = params.memory || {};
    const displayName = this.normalizeDisplayName(params.userName);
    const currentDoc = String(memory.currentDocumentName || '').trim();
    const currentControl = String(memory.currentControlId || memory.controlId || '').trim();
    const preferredPath =
      memory.onboarding?.preferredPath || this.detectPathChoice(params.prompt, params.hasCustomerDocs);
    const pending = memory.onboarding?.pendingQuestion || 'PATH';

    if (language === 'ar') {
      const helloLead = displayName ? `أهلًا يا ${displayName}` : 'أهلًا';
      const politeLead = displayName ? `تمام يا ${displayName}` : 'تمام';
      const formalLead = displayName ? `مرحبًا ${displayName}` : 'مرحبًا';

      if (preferredPath === 'FILE_ANALYSIS') {
        if (!params.hasCustomerDocs) {
          return wantsFormalArabic
            ? `${formalLead}. لتحليل ملف، ارفع ملف PDF أو DOCX أولًا، وبعدها اكتب مثلًا: "لخّص الملف" أو "استخرج الفجوات".`
            : `${politeLead}. لو عايز تحليل ملف، ارفع PDF/DOCX الأول وبعدين قولي: "لخص الملف" أو "طلع الفجوات".`;
        }
        if (currentDoc) {
          return wantsFormalArabic
            ? `${formalLead}، سنعمل على الملف "${currentDoc}".\nاختيارات سريعة:\n1) تلخيص سريع\n2) الفجوات\n3) الأدلة المطلوبة\n4) ربطه بكنترول`
            : `${politeLead}، هنشتغل على "${currentDoc}".\nاختيارات سريعة:\n1) ملخص سريع\n2) الفجوات\n3) الأدلة المطلوبة\n4) ربطه بكنترول`;
        }
        return wantsFormalArabic
          ? `${formalLead}. لديك ملفات مرفوعة. هل تريد تحليل آخر ملف مرفوع، أم ملفًا محددًا بالاسم؟`
          : `${politeLead}. عندك ملفات مرفوعة. تحب نحلل آخر ملف ولا ملف معين؟`;
      }

      if (preferredPath === 'CONTROL_GUIDANCE') {
        if (currentControl) {
          return wantsFormalArabic
            ? `${formalLead}. سنكمل على الكنترول ${currentControl}. هل تريد شرح عناصر الاختبار أم الأدلة المطلوبة؟`
            : `${politeLead}. هنكمل على الكنترول ${currentControl}. تحب شرح test components ولا الأدلة المطلوبة؟`;
        }
        return wantsFormalArabic
          ? `${formalLead}. اكتب كود الكنترول (مثل A.7.4 أو GOV-06) أو اسمه لكي أشرح عناصر الاختبار والأدلة المطلوبة.`
          : `${politeLead}. ابعت كود الكنترول (زي A.7.4 أو GOV-06) أو اسمه وأنا أشرحلك test components والأدلة المطلوبة.`;
      }

      if (preferredPath === 'ACTION_EXECUTION') {
        return wantsFormalArabic
          ? `${formalLead}. اختر الإجراء المطلوب:\n1) إنشاء طلب دليل\n2) ربط دليل بكنترول\n3) إنشاء مهمة معالجة`
          : `${politeLead}. عايز تنفذ أنهي إجراء؟\n1) إنشاء طلب دليل\n2) ربط دليل بكنترول\n3) إنشاء مهمة معالجة`;
      }

      if (preferredPath === 'GENERAL_QA' && pending === 'TOPIC') {
        return wantsFormalArabic
          ? `${formalLead}. اكتب سؤالك مباشرةً (مثال: ما الأدلة المطلوبة للكنترول A.8.2؟).`
          : `${politeLead}، ابعت سؤالك مباشرة (مثال: ايه الأدلة المطلوبة للكنترول A.8.2؟).`;
      }

      if (params.hasCustomerDocs && currentDoc) {
        return wantsFormalArabic
          ? `${formalLead}. لديك ملف مرفوع باسم "${currentDoc}". هل تريد تلخيصه، استخراج الفجوات، أم ربطه بكنترول؟`
          : `${politeLead}. عندك ملف مرفوع "${currentDoc}". تحب ألخصه ولا أطلع الفجوات ولا أربطه بكنترول؟`;
      }

      if (wantsFormalArabic) {
        return [
          `${formalLead}. لنبدأ بشكل عملي.`,
          'اختر مسارًا واحدًا من القائمة:',
          '1) سؤال امتثال عام',
          '2) شرح كنترول وعناصر الاختبار',
          '3) تحليل ملف مرفوع',
          '4) تنفيذ إجراء داخل النظام',
        ].join('\n');
      }
      return [
        `${helloLead}! نبدأ منين؟`,
        'اختار مسار واحد من القائمة:',
        '1) سؤال امتثال عام',
        '2) شرح كنترول وعناصر الاختبار',
        '3) تحليل ملف مرفوع',
        '4) تنفيذ إجراء داخل النظام',
      ].join('\n');
    }

    if (preferredPath === 'FILE_ANALYSIS') {
      if (!params.hasCustomerDocs) {
        return `${this.enLead(displayName)} For file analysis, upload a PDF/DOCX first, then ask: "summarize this file" or "extract gaps".`;
      }
      if (currentDoc) {
        return `${this.enLead(displayName)} We can continue on "${currentDoc}".\nQuick options:\n1) quick summary\n2) gaps\n3) evidence needed\n4) map to control`;
      }
      return `${this.enLead(displayName)} You already have uploaded files. Do you want to analyze the latest file or a specific file name?`;
    }
    if (preferredPath === 'CONTROL_GUIDANCE') {
      if (currentControl) {
        return `${this.enLead(displayName)} We can continue with control ${currentControl}. Do you want test components or evidence requirements?`;
      }
      return `${this.enLead(displayName)} Send the control code (e.g., A.7.4 or GOV-06) and I will explain test components and evidence requirements.`;
    }
    if (preferredPath === 'ACTION_EXECUTION') {
      return [
        `${this.enLead(displayName)} Which action do you want?`,
        '1) create evidence request',
        '2) link evidence to control',
        '3) create remediation task',
      ].join('\n');
    }
    if (preferredPath === 'GENERAL_QA' && pending === 'TOPIC') {
      return `${this.enLead(displayName)} Ask your compliance question directly and I will answer with practical next steps.`;
    }
    if (params.state === 'NEW') {
      return displayName ? `Hello ${displayName}! How can I help you today?` : 'Hello! How can I help you today?';
    }
    return [
      displayName ? `Hello ${displayName}! How can I help you today?` : 'Hello! How can I help you today?',
      'Choose one path from the list:',
      '1) general compliance Q&A',
      '2) control guidance',
      '3) uploaded-file analysis',
      '4) action execution',
    ].join('\n');
  }

  private detectPathChoice(prompt: string, hasCustomerDocs: boolean): OnboardingPathChoice | null {
    if (this.intent.isActionExecutionPrompt(prompt)) return 'ACTION_EXECUTION';
    if (this.intent.isControlGuidancePrompt(prompt) || this.intent.isTestComponentsPrompt(prompt)) {
      return 'CONTROL_GUIDANCE';
    }
    if (this.intent.isFileContextPrompt(prompt) || this.intent.isFileSummaryPrompt(prompt)) {
      return 'FILE_ANALYSIS';
    }
    if (/(question|ask|سؤال|استفسار|اسال|اسأل)/i.test(prompt)) {
      return 'GENERAL_QA';
    }

    const normalized = String(prompt || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const optionMatch = normalized.match(/\b([1-4])\b/);
    if (!optionMatch) return null;
    const option = Number(optionMatch[1]);
    if (hasCustomerDocs) {
      if (option === 1 || option === 3) return 'FILE_ANALYSIS';
      if (option === 2) return 'CONTROL_GUIDANCE';
      if (option === 4) return 'ACTION_EXECUTION';
      return null;
    }
    if (option === 1) return 'GENERAL_QA';
    if (option === 2) return 'CONTROL_GUIDANCE';
    if (option === 3) return 'FILE_ANALYSIS';
    if (option === 4) return 'ACTION_EXECUTION';
    return null;
  }

  private normalizeDisplayName(value?: string | null) {
    const name = String(value || '').trim();
    if (!name) return '';
    const firstToken = name.split(/\s+/)[0] || '';
    return firstToken.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24);
  }

  private enLead(displayName: string) {
    if (!displayName) return 'Great.';
    return `Great ${displayName}.`;
  }
}
