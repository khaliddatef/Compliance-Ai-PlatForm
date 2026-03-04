import { Injectable } from '@nestjs/common';
import { ChatIntentService } from './chat-intent.service';
import type { ChatToneProfile } from './chat-path.types';

@Injectable()
export class ActionExecutionPathHandler {
  constructor(private readonly intent: ChatIntentService) {}

  buildReply(params: {
    prompt: string;
    language?: 'ar' | 'en';
    toneProfile?: ChatToneProfile;
  }) {
    const language = this.intent.resolveReplyLanguage(params.language, params.prompt);
    const wantsFormalArabic = params.toneProfile === 'ARABIC_FORMAL';
    if (language === 'ar') {
      if (wantsFormalArabic) {
        return [
          'ممتاز، يبدو أنك تريد تنفيذ إجراء من خلال الشات.',
          'الإجراءات المتاحة حاليًا: إنشاء طلب دليل، ربط دليل بكنترول، إنشاء مهمة معالجة.',
          'اكتب الأمر بصيغة مباشرة مثل:',
          '- أنشئ طلب دليل للكنترول A.7.4 بتاريخ استحقاق 2026-03-20',
          '- اربط الدليل <evidenceId> بالكنترول GOV-06',
          '- أنشئ مهمة معالجة بعنوان "Update BYOD policy"',
        ].join('\n');
      }
      return [
        'تمام، واضح إنك عايز تنفّذ إجراء من الشات.',
        'المتاح دلوقتي: إنشاء طلب دليل، ربط دليل بكنترول، إنشاء مهمة معالجة.',
        'ابعتلي الأمر بشكل مباشر زي:',
        '- أنشئ طلب دليل للكنترول A.7.4 بتاريخ استحقاق 2026-03-20',
        '- اربط الدليل <evidenceId> بالكنترول GOV-06',
        '- أنشئ مهمة معالجة بعنوان "Update BYOD policy"',
      ].join('\n');
    }
    return [
      'Understood. You want to execute an action from chat.',
      'Available actions: create evidence request, link evidence to control, create remediation task.',
      'Send one explicit command, for example:',
      '- Create evidence request for control A.7.4 due 2026-03-20',
      '- Link evidence <evidenceId> to control GOV-06',
      '- Create remediation task titled "Update BYOD policy"',
    ].join('\n');
  }
}
