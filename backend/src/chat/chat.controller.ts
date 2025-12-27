import { Body, Controller, Post } from '@nestjs/common';
import { ChatService, ComplianceStandard } from './chat.service';
import { AgentService } from '../agent/agent.service';

@Controller('api/chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly agent: AgentService,
  ) {}

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
          status: 'PARTIAL',
          missing: [],
          recommendations: [],
        },
      };
    }

    // 1) Save user message (customer conversation)
    const { conv } = await this.chatService.addMessage({
      conversationId: body.conversationId,
      title: 'New compliance chat',
      role: 'user',
      content: prompt,
    });

    // 2) Retrieve STANDARD + CUSTOMER chunks
    const standardConversationId = `std-${standard}`; // ✅ ثابت عندك
    const [standardHits, customerHits] = await Promise.all([
      this.chatService.retrieveTopChunks({
        conversationId: standardConversationId,
        standard,
        kind: 'STANDARD',
        query: prompt,
        topK: 6,
        maxScan: 500,
      }),
      this.chatService.retrieveTopChunks({
        conversationId: conv.id,
        standard,
        kind: 'CUSTOMER',
        query: prompt,
        topK: 6,
        maxScan: 500,
      }),
    ]);
    console.log('STD hits:', standardHits.length, standardHits[0]?.docName);
    console.log('CUS hits:', customerHits.length, customerHits[0]?.docName);
    // 3) Agent generates final answer (JSON)
    const agentOut = await this.agent.answerCompliance({
      standard,
      question: prompt,
      standardHits,
      customerHits,
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
