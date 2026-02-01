import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service';
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
    if (user.role === 'MANAGER') {
      return this.chatService.hideConversationForUser(conversationId, user.id);
    }
    return this.chatService.deleteConversation(conversationId);
  }

  @Get('conversations')
  async listConversations(@CurrentUser() user: AuthUser) {
    const isPrivileged = user.role !== 'USER';
    const where: any = isPrivileged ? { userId: { not: null } } : { userId: user.id };
    if (user.role === 'MANAGER') {
      where.hiddenBy = { none: { userId: user.id, hidden: true } };
    }

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
      language?: 'ar' | 'en';
    },
  ) {
    const prompt = (body?.message || '').trim();

    if (!prompt) {
      return {
        conversationId: body?.conversationId || '',
        reply: 'Empty message.',
        citations: [],
        complianceSummary: {
          framework: null,
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

    const [evidenceChunks, docCount] = await Promise.all([
      this.chatService.retrieveTopChunks({
        conversationId: conv.id,
        kind: 'CUSTOMER',
        query: prompt,
        topK: 6,
      }),
      this.prisma.document.count({
        where: { conversationId: conv.id, kind: 'CUSTOMER' },
      }),
    ]);

    // 3) Agent answers (Responses API, customer evidence from DB only)
    const activeFramework = await this.controlKb.getActiveFrameworkLabel();
    const agentOut = await this.agent.answerCompliance({
      framework: activeFramework,
      question: prompt,
      evidenceChunks,
      hasCustomerDocs: docCount > 0,
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
      control?: ControlContext;
      controlId?: string;
      language?: 'ar' | 'en';
    },
  ) {
    const conversationId = body?.conversationId;
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

    const kbControl = await this.controlKb.getControlContextByCode({
      controlCode: String(controlId),
      includeDisabled: user?.role === 'ADMIN',
    });

    const normalizedControl: ControlContext = kbControl || {
      id: String(controlId),
      title: String(control?.title || ''),
      summary: String(control?.summary || ''),
      evidence: Array.isArray(control?.evidence) ? control.evidence : [],
      testComponents: Array.isArray(control?.testComponents) ? control.testComponents : [],
    };

    const [evidenceChunks, docCount] = await Promise.all([
      this.chatService.retrieveTopChunks({
        conversationId,
        kind: 'CUSTOMER',
        query: [
          normalizedControl.id,
          normalizedControl.title,
          ...(normalizedControl.evidence || []),
          ...(normalizedControl.testComponents || []),
        ]
          .filter(Boolean)
          .join(' '),
        topK: 8,
      }),
      this.prisma.document.count({
        where: { conversationId, kind: 'CUSTOMER' },
      }),
    ]);

    const activeFramework = await this.controlKb.getActiveFrameworkLabel();
    const evaluation = await this.agent.evaluateControlEvidence({
      framework: activeFramework,
      control: normalizedControl,
      evidenceChunks,
      hasCustomerDocs: docCount > 0,
      language: body?.language,
    });

    const saved = await this.prisma.evidenceEvaluation.create({
      data: {
        conversationId,
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
