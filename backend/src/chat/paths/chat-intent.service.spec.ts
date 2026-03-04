import { ChatIntentService } from './chat-intent.service';

describe('ChatIntentService', () => {
  const intent = new ChatIntentService();

  it('recognizes onboarding colloquial and typo prompts', () => {
    expect(intent.isOnboardingPrompt('helo')).toBe(true);
    expect(intent.isOnboardingPrompt('اي الدنيا')).toBe(true);
    expect(intent.isOnboardingPrompt('ممكن تساعدني')).toBe(true);
  });

  it('does not treat short acknowledgement as small talk in active task context', () => {
    const result = intent.isSmallTalkPrompt('اه', {
      hasCustomerDocs: true,
      lastRoute: 'FILE_ANALYSIS',
      previousUserPrompt: 'لخص الملف دا',
      state: 'ACTIVE_TASK',
    });
    expect(result).toBe(false);
  });
});

