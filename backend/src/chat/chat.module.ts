import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentService } from '../agent/agent.service';
import { AuthModule } from '../auth/auth.module';
import { ControlKbModule } from '../control-kb/control-kb.module';
import { UploadModule } from '../upload/upload.module';
import { CopilotModule } from '../copilot/copilot.module';
import { ChatIntentService } from './paths/chat-intent.service';
import { ChatRouteClassifierService } from './paths/chat-route-classifier.service';
import { OnboardingPathHandler } from './paths/onboarding-path.handler';
import { ActionExecutionPathHandler } from './paths/action-execution-path.handler';
import { ControlGuidancePathHandler } from './paths/control-guidance-path.handler';
import { FileAnalysisPathHandler } from './paths/file-analysis-path.handler';
import { RouteQuestionHandler } from './paths/route-question.handler';
import { ChatConversationStateService } from './paths/chat-conversation-state.service';
import { ChatMemoryService } from './paths/chat-memory.service';
import { ChatResponseGuardService } from './paths/chat-response-guard.service';
import { ChatPathAgentRouterService } from './paths/chat-path-agent-router.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, AuthModule, ControlKbModule, UploadModule, CopilotModule, SettingsModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    AgentService,
    ChatIntentService,
    ChatRouteClassifierService,
    OnboardingPathHandler,
    ActionExecutionPathHandler,
    ControlGuidancePathHandler,
    FileAnalysisPathHandler,
    RouteQuestionHandler,
    ChatConversationStateService,
    ChatMemoryService,
    ChatResponseGuardService,
    ChatPathAgentRouterService,
  ],
  exports: [ChatService],
})
export class ChatModule {}
