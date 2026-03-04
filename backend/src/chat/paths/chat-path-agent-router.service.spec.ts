import { ActionExecutionPathHandler } from './action-execution-path.handler';
import { ChatIntentService } from './chat-intent.service';
import { ChatPathAgentRouterService } from './chat-path-agent-router.service';
import { OnboardingPathHandler } from './onboarding-path.handler';

describe('ChatPathAgentRouterService', () => {
  const intent = new ChatIntentService();
  const onboarding = new OnboardingPathHandler(intent);
  const actionExecution = new ActionExecutionPathHandler(intent);
  const router = new ChatPathAgentRouterService(intent, onboarding, actionExecution);

  it('avoids repeating onboarding after conversation already onboarded', () => {
    const effective = router.resolveEffectiveRoute({
      decision: {
        path: 'ONBOARDING',
        confidence: 0.82,
        reasons: ['onboarding-smalltalk'],
      },
      prompt: 'فهمني اكتر',
      state: 'ONBOARDED',
      hasCustomerDocs: false,
      lastRoute: 'ONBOARDING',
    });
    expect(effective).toBe('GENERAL_QA');
  });
});
