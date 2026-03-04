import { ChatIntentService } from './chat-intent.service';
import { ChatResponseGuardService } from './chat-response-guard.service';

describe('ChatResponseGuardService', () => {
  const intent = new ChatIntentService();
  const guard = new ChatResponseGuardService(intent);

  it('asks clarification on low confidence route decision', () => {
    const shouldAsk = guard.shouldAskClarification({
      decision: {
        path: 'GENERAL_QA',
        confidence: 0.4,
        reasons: ['fallback'],
        candidates: [
          { path: 'GENERAL_QA', score: 0.3 },
          { path: 'ONBOARDING', score: 0.25 },
        ],
      },
      prompt: 'محتاج توضيح',
      state: 'ONBOARDED',
    });
    expect(shouldAsk).toBe(true);
  });

  it('rephrases duplicated assistant reply', () => {
    const result = guard.dedupeAssistantReply({
      reply: 'جاهز. نقدر نشتغل على 3 مسارات.',
      previousAssistantReply: 'جاهز. نقدر نشتغل على 3 مسارات.',
      language: 'ar',
    });
    expect(result).not.toBe('جاهز. نقدر نشتغل على 3 مسارات.');
  });
});
