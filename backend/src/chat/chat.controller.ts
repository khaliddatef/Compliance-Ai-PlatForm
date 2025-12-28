import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { ChatService, ComplianceStandard } from './chat.service';
import { AgentService } from '../agent/agent.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api/chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly agent: AgentService,
    private readonly prisma: PrismaService,
  ) {}

  @Delete(':conversationId')
  async deleteChat(@Param('conversationId') conversationId: string) {
    return this.chatService.deleteConversation(conversationId);
  }

  @Post()
  async chat(
    @Body()
    body: {
      conversationId?: string;
      message: string;
      standard: ComplianceStandard;
    },
  ) {
    const prompt = (body?.message || '').trim();
    const standard = body?.standard || 'ISO';

    if (!prompt) {
      return {
        conversationId: body?.conversationId || '',
        reply: 'Empty message.',
        citations: [],
        complianceSummary: {
          standard,
          status: 'UNKNOWN',
          missing: [],
          recommendations: [],
        },
      };
    }

    // 1) Save user message
    const { conv } = await this.chatService.addMessage({
      conversationId: body.conversationId,
      title: 'New compliance chat',
      role: 'user',
      content: prompt,
    });

    // 2) Load conversation to get customerVectorStoreId
    const convRow = await this.prisma.conversation.findUnique({ where: { id: conv.id } });
    const customerVectorStoreId = (convRow as any)?.customerVectorStoreId || null;

    // 3) Agent answers (Responses API + file_search)
    const agentOut = await this.agent.answerCompliance({
      standard,
      question: prompt,
      customerVectorStoreId,
    });

    // 4) Save assistant message
    await this.chatService.addMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: agentOut.reply,
    });

    return {
      conversationId: conv.id,
      reply: agentOut.reply,
      citations: agentOut.citations || [],
      complianceSummary: agentOut.complianceSummary,
    };
  }
}
