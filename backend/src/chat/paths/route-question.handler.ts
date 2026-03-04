import { Injectable } from '@nestjs/common';
import type { ChatPath } from './chat-path.types';
import { ChatIntentService } from './chat-intent.service';

@Injectable()
export class RouteQuestionHandler {
  constructor(private readonly intent: ChatIntentService) {}

  decorate(params: {
    prompt: string;
    route: ChatPath;
    language?: 'ar' | 'en';
  }) {
    const prompt = String(params.prompt || '').trim();
    if (!prompt) return prompt;

    const language = this.intent.resolveReplyLanguage(params.language, prompt);
    if (params.route === 'FILE_ANALYSIS') {
      return language === 'ar'
        ? `[مسار: تحليل ملف] ركّز على الملفات المرفوعة كسياق أساسي. الطلب: ${prompt}`
        : `[Route: File analysis] Prioritize uploaded-file evidence as primary context. Request: ${prompt}`;
    }
    if (params.route === 'CONTROL_GUIDANCE') {
      return language === 'ar'
        ? `[مسار: إرشاد كنترول] ركّز على شرح الكنترول/عناصر الاختبار والمتطلبات العملية. الطلب: ${prompt}`
        : `[Route: Control guidance] Focus on control/test-components explanation and practical evidence requirements. Request: ${prompt}`;
    }
    return prompt;
  }
}
