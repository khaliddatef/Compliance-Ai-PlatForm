import { ChatIntentService } from './chat-intent.service';
import { OnboardingPathHandler } from './onboarding-path.handler';

describe('OnboardingPathHandler', () => {
  const intent = new ChatIntentService();
  const handler = new OnboardingPathHandler(intent);

  it('personalizes onboarding reply with current uploaded document', () => {
    const reply = handler.buildReply({
      prompt: 'عاوز احلل الملف',
      language: 'ar',
      hasCustomerDocs: true,
      memory: {
        currentDocumentName: 'BYOD Policy.docx',
        onboarding: {
          stage: 'PATH_SELECTED',
          preferredPath: 'FILE_ANALYSIS',
          pendingQuestion: 'TOPIC',
        },
      },
    });
    expect(reply).toContain('BYOD Policy.docx');
  });

  it('guides user to upload when file-analysis path selected without files', () => {
    const reply = handler.buildReply({
      prompt: 'حلل الملف',
      language: 'ar',
      hasCustomerDocs: false,
    });
    expect(reply).toContain('ارفع');
  });

  it('greets the user by first name in english onboarding', () => {
    const reply = handler.buildReply({
      prompt: 'hi',
      language: 'en',
      hasCustomerDocs: false,
      state: 'NEW',
      userName: 'Omar Khaled',
    });
    expect(reply).toBe('Hello Omar! How can I help you today?');
  });
});
