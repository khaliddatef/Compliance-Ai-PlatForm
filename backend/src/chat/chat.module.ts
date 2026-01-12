import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentService } from '../agent/agent.service';
import { AuthModule } from '../auth/auth.module';
import { ControlKbModule } from '../control-kb/control-kb.module';

@Module({
  imports: [PrismaModule, AuthModule, ControlKbModule],
  controllers: [ChatController],
  providers: [ChatService, AgentService],
  exports: [ChatService],
})
export class ChatModule {}
