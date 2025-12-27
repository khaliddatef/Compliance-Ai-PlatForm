import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentService } from '../agent/agent.service';

@Module({
  imports: [PrismaModule],
  controllers: [ChatController],
  providers: [ChatService, AgentService],
  exports: [ChatService],
})
export class ChatModule {}
