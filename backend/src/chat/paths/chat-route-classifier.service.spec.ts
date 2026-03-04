import { ChatIntentService } from './chat-intent.service';
import { ChatRouteClassifierService } from './chat-route-classifier.service';

describe('ChatRouteClassifierService', () => {
  const intent = new ChatIntentService();
  const classifier = new ChatRouteClassifierService(intent);

  it('prefers ACTION_EXECUTION for explicit action prompt', () => {
    const result = classifier.classify({
      prompt: 'create evidence request for A.7.4',
      mentionDocumentIds: [],
      hasCustomerDocs: false,
    });
    expect(result.path).toBe('ACTION_EXECUTION');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('preserves last route for short follow-up prompts', () => {
    const result = classifier.classify({
      prompt: 'ايه؟',
      mentionDocumentIds: [],
      hasCustomerDocs: true,
      previousUserPrompt: 'لخص الملف دا',
      lastRoute: 'FILE_ANALYSIS',
      state: 'ACTIVE_TASK',
    });
    expect(result.path).toBe('FILE_ANALYSIS');
  });

  it('does not bounce acknowledgement to onboarding during active file context', () => {
    const result = classifier.classify({
      prompt: 'اه',
      mentionDocumentIds: [],
      hasCustomerDocs: true,
      previousUserPrompt: 'راجع الملف دا',
      lastRoute: 'FILE_ANALYSIS',
      state: 'ACTIVE_TASK',
    });
    expect(result.path).toBe('FILE_ANALYSIS');
  });
});
