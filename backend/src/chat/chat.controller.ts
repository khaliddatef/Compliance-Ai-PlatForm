import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ChatService, ComplianceStandard } from './chat.service';
import { AgentService, ControlContext } from '../agent/agent.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.service';
import { ControlKbService } from '../control-kb/control-kb.service';

@UseGuards(AuthGuard)
@Controller('api/chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly agent: AgentService,
    private readonly prisma: PrismaService,
    private readonly controlKb: ControlKbService,
  ) {}

  @Delete(':conversationId')
  async deleteChat(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assertConversationAccess(conversationId, user);
    return this.chatService.deleteConversation(conversationId);
  }

  @Get('conversations')
  async listConversations(@CurrentUser() user: AuthUser) {
    const isPrivileged = user.role !== 'USER';
    const where = isPrivileged ? { userId: { not: null } } : { userId: user.id };

    const rows = await this.prisma.conversation.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, createdAt: true },
        },
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: row._count.messages,
      lastMessage: row.messages[0]?.content ?? null,
      lastMessageAt: row.messages[0]?.createdAt ?? null,
      user: row.user
        ? {
            id: row.user.id,
            name: row.user.name,
            email: row.user.email,
            role: row.user.role,
          }
        : null,
    }));
  }

  @Get(':conversationId/messages')
  async listConversationMessages(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assertConversationAccess(conversationId, user);
    const messages = await this.chatService.listMessages(conversationId);
    return messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    }));
  }

  @Get(':conversationId')
  async getConversation(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assertConversationAccess(conversationId, user);

    const row = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        _count: { select: { messages: true } },
      },
    });

    if (!row) {
      throw new NotFoundException('Conversation not found');
    }

    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: row._count.messages,
      user: row.user
        ? {
            id: row.user.id,
            name: row.user.name,
            email: row.user.email,
            role: row.user.role,
          }
        : null,
    };
  }

  @Post()
  async chat(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      conversationId?: string;
      message: string;
      standard: ComplianceStandard;
      language?: 'ar' | 'en';
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

    if (body?.conversationId) {
      await this.assertConversationAccess(body.conversationId, user);
    }

    // 1) Save user message
    const { conv } = await this.chatService.addMessage({
      conversationId: body.conversationId,
      title: 'New compliance chat',
      role: 'user',
      content: prompt,
      userId: user.id,
    });

    // 2) Load conversation to get customerVectorStoreId
    const convRow = await this.prisma.conversation.findUnique({ where: { id: conv.id } });
    const customerVectorStoreId = (convRow as any)?.customerVectorStoreId || null;

    // 3) Agent answers (Responses API + file_search)
    const agentOut = await this.agent.answerCompliance({
      standard,
      question: prompt,
      customerVectorStoreId,
      language: body?.language,
    });

    // 4) Save assistant message
    await this.chatService.addMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: agentOut.reply,
      userId: user.id,
    });

    return {
      conversationId: conv.id,
      reply: agentOut.reply,
      citations: agentOut.citations || [],
      complianceSummary: agentOut.complianceSummary,
      externalLinks: agentOut.externalLinks || [],
    };
  }

  @Post('evaluate')
  async evaluateControl(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      conversationId: string;
      standard: ComplianceStandard;
      control?: ControlContext;
      controlId?: string;
      language?: 'ar' | 'en';
    },
  ) {
    const conversationId = body?.conversationId;
    const standard = body?.standard || 'ISO';
    const control = body?.control;
    const controlId = body?.controlId || control?.id;

    if (!conversationId || !controlId) {
      return {
        ok: false,
        message: 'conversationId and control are required',
      };
    }

    await this.assertConversationAccess(conversationId, user);

    await this.prisma.conversation.upsert({
      where: { id: conversationId },
      create: { id: conversationId, title: 'New compliance chat', userId: user.id },
      update: { updatedAt: new Date() },
    });

    const convRow = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    const customerVectorStoreId = (convRow as any)?.customerVectorStoreId || null;

    const kbControl = await this.controlKb.getControlContextByCode({
      controlCode: String(controlId),
      standard,
    });

    const normalizedControl: ControlContext = kbControl || {
      id: String(controlId),
      title: String(control?.title || ''),
      summary: String(control?.summary || ''),
      evidence: Array.isArray(control?.evidence) ? control.evidence : [],
      testComponents: Array.isArray(control?.testComponents) ? control.testComponents : [],
    };

    const evaluation = await this.agent.evaluateControlEvidence({
      standard,
      control: normalizedControl,
      customerVectorStoreId,
      language: body?.language,
    });

    const saved = await this.prisma.evidenceEvaluation.create({
      data: {
        conversationId,
        standard,
        controlId: normalizedControl.id,
        status: evaluation.status,
        summary: evaluation.summary,
        satisfied: evaluation.satisfied,
        missing: evaluation.missing,
        recommendations: evaluation.recommendations,
        citations: evaluation.citations,
      },
    });

    return {
      ok: true,
      conversationId,
      controlId: normalizedControl.id,
      evaluation,
      evaluationId: saved.id,
    };
  }

  private async assertConversationAccess(conversationId: string, user: AuthUser) {
    if (!conversationId) return;
    if (user.role !== 'USER') return;

    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });

    if (!conv) return;

    if (!conv.userId) {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { userId: user.id },
      });
      return;
    }

    if (conv.userId !== user.id) {
      throw new ForbiddenException('Not allowed to access this conversation');
    }
  }
}
