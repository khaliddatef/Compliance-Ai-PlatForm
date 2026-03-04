import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service';
import { AgentService, ControlContext } from '../agent/agent.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.service';
import { ControlKbService } from '../control-kb/control-kb.service';
import { CopilotService } from '../copilot/copilot.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { ChatIntentService } from './paths/chat-intent.service';
import { ChatRouteClassifierService } from './paths/chat-route-classifier.service';
import { ControlGuidancePathHandler } from './paths/control-guidance-path.handler';
import { FileAnalysisPathHandler } from './paths/file-analysis-path.handler';
import { RouteQuestionHandler } from './paths/route-question.handler';
import { ChatConversationStateService } from './paths/chat-conversation-state.service';
import { ChatMemoryService } from './paths/chat-memory.service';
import { ChatResponseGuardService } from './paths/chat-response-guard.service';
import { ChatPathAgentRouterService } from './paths/chat-path-agent-router.service';
import type { ChatPath, ConversationState } from './paths/chat-path.types';
import { SettingsService, type AiToneProfile } from '../settings/settings.service';

@UseGuards(AuthGuard)
@Controller('api/chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly agent: AgentService,
    private readonly prisma: PrismaService,
    private readonly controlKb: ControlKbService,
    private readonly copilot: CopilotService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly intent: ChatIntentService,
    private readonly routeClassifier: ChatRouteClassifierService,
    private readonly controlGuidanceHandler: ControlGuidancePathHandler,
    private readonly fileAnalysisHandler: FileAnalysisPathHandler,
    private readonly routeQuestionHandler: RouteQuestionHandler,
    private readonly conversationState: ChatConversationStateService,
    private readonly memoryService: ChatMemoryService,
    private readonly responseGuard: ChatResponseGuardService,
    private readonly pathAgentRouter: ChatPathAgentRouterService,
    private readonly settings: SettingsService,
  ) {}

  @Delete(':conversationId')
  async deleteChat(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assertConversationReadAccess(conversationId, user);
    if (user.role === 'MANAGER') {
      return this.chatService.hideConversationForUser(conversationId, user.id);
    }
    return this.chatService.deleteConversation(conversationId);
  }

  @Get('conversations')
  async listConversations(@CurrentUser() user: AuthUser) {
    const role = this.normalizeRole(user.role);
    const baseWhere: any =
      role === 'ADMIN'
        ? { userId: { not: null } }
        : role === 'MANAGER'
          ? {
              userId: { not: null },
              OR: [{ userId: user.id }, { user: { role: 'USER' } }],
            }
          : { userId: user.id };
    const include = {
      user: { select: { id: true, name: true, email: true, role: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { content: true, createdAt: true },
      },
      _count: { select: { messages: true } },
    } as const;
    const orderBy = { updatedAt: 'desc' } as const;

    const managerWhere =
      role === 'MANAGER'
        ? { ...baseWhere, hiddenBy: { none: { userId: user.id, hidden: true } } }
        : baseWhere;

    let rows;
    try {
      rows = await this.prisma.conversation.findMany({
        where: managerWhere,
        include,
        orderBy,
      });
    } catch (error) {
      if (role !== 'MANAGER') throw error;
      rows = await this.prisma.conversation.findMany({
        where: baseWhere,
        include,
        orderBy,
      });
    }

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
    await this.assertConversationReadAccess(conversationId, user);
    const messages = await this.chatService.listMessages(conversationId);
    return messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      messageType: message.messageType || 'TEXT',
      cards: this.safeJson(message.cardsJson),
      actions: this.safeJson(message.actionsJson),
      sources: this.sanitizePublicSources(this.safeJson(message.sourcesJson)),
      createdAt: message.createdAt,
    }));
  }

  @Get(':conversationId')
  async getConversation(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assertConversationReadAccess(conversationId, user);

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
      mentionDocumentIds?: string[];
    },
  ) {
    const prompt = (body?.message || '').trim();
    const aiSettings = await this.settings.getAiSettings(user).catch(() => null);
    const toneProfile = this.resolveToneProfile(aiSettings?.toneProfile);
    const resolvedLanguage = this.resolvePreferredLanguage({
      requestLanguage: body?.language,
      aiLanguage: aiSettings?.language,
      prompt,
    });
    const mentionDocumentIds = Array.isArray(body?.mentionDocumentIds)
      ? Array.from(
          new Set(
            body.mentionDocumentIds
              .map((id) => String(id || '').trim())
              .filter(Boolean),
          ),
        )
      : [];

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
      await this.assertConversationWriteAccess(body.conversationId, user);
    }

    // 1) Save user message
    const { conv } = await this.chatService.addMessage({
      conversationId: body.conversationId,
      title: 'New compliance chat',
      role: 'user',
      content: prompt,
      userId: user.id,
    });

    const readableMentions = mentionDocumentIds.length
      ? await this.resolveReadableMentionDocumentIds(mentionDocumentIds, user, conv.id)
      : [];
    const readableMentionDocumentIds = readableMentions.map((item) => item.id);

    const [
      topChunks,
      docCount,
      recentUserMessages,
      recentAssistantMessages,
      userMessageCount,
      assistantMessageCount,
      mentionedChunks,
    ] = await Promise.all([
      this.chatService.retrieveTopChunks({
        conversationId: conv.id,
        kind: 'CUSTOMER',
        query: prompt,
        topK: 6,
      }),
      this.prisma.document.count({
        where: { conversationId: conv.id, kind: 'CUSTOMER' },
      }),
      this.prisma.message.findMany({
        where: { conversationId: conv.id, role: 'user' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 2,
        select: { content: true },
      }),
      this.prisma.message.findMany({
        where: { conversationId: conv.id, role: 'assistant' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
        select: { content: true, sourcesJson: true },
      }),
      this.prisma.message.count({
        where: { conversationId: conv.id, role: 'user' },
      }),
      this.prisma.message.count({
        where: { conversationId: conv.id, role: 'assistant' },
      }),
      readableMentionDocumentIds.length
        ? this.chatService.retrieveChunksByDocumentIds({
            kind: 'CUSTOMER',
            documentIds: readableMentionDocumentIds,
            query: prompt,
            topK: 12,
          })
        : Promise.resolve([]),
    ]);

    const previousUserPrompt = String(recentUserMessages[1]?.content || '').trim();
    const previousAssistantReply = String(recentAssistantMessages[0]?.content || '').trim();
    const { lastRoute, memory: previousMemory } =
      this.memoryService.resolveLastRouteAndMemory(recentAssistantMessages);
    const currentState = this.conversationState.resolve({
      userMessageCount,
      assistantMessageCount,
      hasCustomerDocs: docCount > 0,
      lastRoute,
    });

    const routeDecision = this.routeClassifier.classify({
      prompt,
      mentionDocumentIds: readableMentionDocumentIds,
      hasCustomerDocs: docCount > 0,
      previousUserPrompt,
      lastRoute,
      state: currentState,
    });
    const effectiveRoute = this.pathAgentRouter.resolveEffectiveRoute({
      decision: routeDecision,
      prompt,
      state: currentState,
      hasCustomerDocs: docCount > 0,
      lastRoute,
    });
    const route = { ...routeDecision, path: effectiveRoute };
    const confidenceBand = this.responseGuard.getConfidenceBand(route.confidence);
    const activeFramework = await this.controlKb.getActiveFrameworkLabel();
    const nextState = this.deriveNextState(currentState, effectiveRoute);
    const memory = this.memoryService.buildMemory({
      previous: previousMemory,
      prompt,
      route: effectiveRoute,
      language: resolvedLanguage,
      toneProfile,
      activeFramework,
      hasCustomerDocs: docCount > 0,
      mentionDocumentIds: readableMentionDocumentIds,
      mentionDocuments: readableMentions,
    });
    const routeMeta = this.memoryService.toRouteMeta({
      state: nextState,
      route: effectiveRoute,
      confidence: route.confidence,
      confidenceBand,
      memory,
    });

    const directControlTestComponents =
      await this.controlGuidanceHandler.tryBuildDirectControlTestComponentsReply({
        prompt,
        language: resolvedLanguage,
        user,
      });
    if (directControlTestComponents) {
      const dedupedReply = this.responseGuard.dedupeAssistantReply({
        reply: directControlTestComponents.reply,
        previousAssistantReply,
        language: resolvedLanguage,
        toneProfile,
      });
      await this.chatService.addMessage({
        conversationId: conv.id,
        role: 'assistant',
        content: dedupedReply,
        userId: user.id,
        sources: this.memoryService.appendRouteMetaToSources(null, {
          ...routeMeta,
          route: 'CONTROL_GUIDANCE',
          state: 'ACTIVE_TASK',
          confidenceBand: 'HIGH',
        }),
      });
      return {
        conversationId: conv.id,
        reply: dedupedReply,
        citations: [],
        complianceSummary: {
          framework: null,
          status: 'UNKNOWN',
          missing: [],
          recommendations: [],
        },
        externalLinks: [],
        route: {
          path: 'CONTROL_GUIDANCE',
          confidence: 0.98,
          confidenceBand: 'HIGH',
        },
        state: 'ACTIVE_TASK',
        memory,
      };
    }

    if (this.responseGuard.shouldAskClarification({ decision: route, prompt, state: currentState })) {
      const clarificationBase = this.responseGuard.dedupeAssistantReply({
        reply: this.responseGuard.buildClarificationQuestion({
          prompt,
          language: resolvedLanguage,
          toneProfile,
        }),
        previousAssistantReply,
        language: resolvedLanguage,
        toneProfile,
      });
      const clarification = this.personalizeAssistantReply({
        reply: clarificationBase,
        language: resolvedLanguage,
        route: route.path,
        userName: user.name,
      });
      await this.chatService.addMessage({
        conversationId: conv.id,
        role: 'assistant',
        content: clarification,
        userId: user.id,
        sources: this.memoryService.appendRouteMetaToSources(null, routeMeta),
      });
      return {
        conversationId: conv.id,
        reply: clarification,
        citations: [],
        complianceSummary: {
          framework: null,
          status: 'UNKNOWN',
          missing: [],
          recommendations: [],
        },
        externalLinks: [],
        route: {
          path: route.path,
          confidence: route.confidence,
          confidenceBand,
        },
        state: nextState,
        memory,
      };
    }

    const evidenceChunks = await this.fileAnalysisHandler.selectEvidenceChunks({
      conversationId: conv.id,
      prompt,
      docCount,
      routePath: route.path,
      topChunks,
      mentionedChunks,
    });

    const directRouteReply = this.pathAgentRouter.tryHandleDirectRoute({
      route: route.path,
      prompt,
      language: resolvedLanguage,
      toneProfile,
      hasCustomerDocs: docCount > 0,
      state: currentState,
      memory,
      userName: user.name,
    });
    if (directRouteReply) {
      const dedupedReply = this.responseGuard.dedupeAssistantReply({
        reply: directRouteReply,
        previousAssistantReply,
        language: resolvedLanguage,
        toneProfile,
      });
      const reply = this.personalizeAssistantReply({
        reply: dedupedReply,
        language: resolvedLanguage,
        route: route.path,
        userName: user.name,
      });
      await this.chatService.addMessage({
        conversationId: conv.id,
        role: 'assistant',
        content: reply,
        userId: user.id,
        sources: this.memoryService.appendRouteMetaToSources(null, routeMeta),
      });
      return {
        conversationId: conv.id,
        reply,
        citations: [],
        complianceSummary: {
          framework: null,
          status: 'UNKNOWN',
          missing: [],
          recommendations: [],
        },
        externalLinks: [],
        route: {
          path: route.path,
          confidence: route.confidence,
          confidenceBand,
        },
        state: nextState,
        memory,
      };
    }

    // 3) Agent answers (Responses API, customer evidence from DB only)
    const routedQuestion = this.routeQuestionHandler.decorate({
      prompt,
      route: route.path,
      language: resolvedLanguage,
    });
    const agentOut = await this.agent.answerCompliance({
      framework: activeFramework,
      question: routedQuestion,
      evidenceChunks,
      hasCustomerDocs: docCount > 0 || mentionedChunks.length > 0,
      language: resolvedLanguage,
      toneProfile,
    });

    const useStructuredResponse =
      this.featureFlags.isEnabled('copilotStructured') &&
      !this.intent.isSmallTalkPrompt(prompt, {
        hasCustomerDocs: docCount > 0,
        lastRoute,
        previousUserPrompt,
        state: currentState,
      }) &&
      (route.path === 'FILE_ANALYSIS' || route.path === 'CONTROL_GUIDANCE');
    const guardedAgentReply = this.responseGuard.dedupeAssistantReply({
      reply: agentOut.reply,
      previousAssistantReply,
      language: resolvedLanguage,
      toneProfile,
    });
    const personalizedGuardedAgentReply = this.personalizeAssistantReply({
      reply: guardedAgentReply,
      language: resolvedLanguage,
      route: route.path,
      userName: user.name,
    });

    if (!useStructuredResponse) {
      await this.chatService.addMessage({
        conversationId: conv.id,
        role: 'assistant',
        content: personalizedGuardedAgentReply,
        userId: user.id,
        sources: this.memoryService.appendRouteMetaToSources(null, routeMeta),
      });

      return {
        conversationId: conv.id,
        reply: personalizedGuardedAgentReply,
        citations: agentOut.citations || [],
        complianceSummary: agentOut.complianceSummary,
        externalLinks: agentOut.externalLinks || [],
        route: {
          path: route.path,
          confidence: route.confidence,
          confidenceBand,
        },
        state: nextState,
        memory,
      };
    }

    const structured = this.copilot.buildStructuredResponse({
      framework: activeFramework,
      status: agentOut.complianceSummary.status,
      reply: personalizedGuardedAgentReply,
      missing: agentOut.complianceSummary.missing || [],
      recommendations: agentOut.complianceSummary.recommendations || [],
      citations: (agentOut.citations || []).map((item) => ({
        doc: item.doc,
        page: item.page ?? null,
      })),
    });
    const sourcesWithRouteMeta = this.memoryService.appendRouteMetaToSources(
      structured.sources,
      routeMeta,
    );

    // 4) Save assistant message
    await this.chatService.addMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: personalizedGuardedAgentReply,
      userId: user.id,
      messageType: structured.messageType,
      cards: structured.cards,
      actions: structured.actions,
      sources: sourcesWithRouteMeta,
    });

    return {
      conversationId: conv.id,
      reply: personalizedGuardedAgentReply,
      citations: agentOut.citations || [],
      complianceSummary: agentOut.complianceSummary,
      externalLinks: agentOut.externalLinks || [],
      messageType: structured.messageType,
      cards: structured.cards,
      actions: structured.actions,
      sources: this.sanitizePublicSources(sourcesWithRouteMeta),
      route: {
        path: route.path,
        confidence: route.confidence,
        confidenceBand,
      },
      state: nextState,
      memory,
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

    const aiSettings = await this.settings.getAiSettings(user).catch(() => null);
    const toneProfile = this.resolveToneProfile(aiSettings?.toneProfile);
    const resolvedLanguage = this.resolvePreferredLanguage({
      requestLanguage: body?.language,
      aiLanguage: aiSettings?.language,
      prompt: `${controlId} ${control?.title || ''}`.trim(),
    });

    await this.assertConversationWriteAccess(conversationId, user);

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
      language: resolvedLanguage,
      toneProfile,
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

  private async assertConversationReadAccess(conversationId: string, user: AuthUser) {
    if (!conversationId) return;

    const role = this.normalizeRole(user.role);
    if (role === 'ADMIN') return;

    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        userId: true,
        user: { select: { role: true } },
      },
    });

    if (!conv) return;

    const ownerId = String(conv.userId || '').trim();
    const ownerRole = this.normalizeRole(conv.user?.role);

    if (role === 'MANAGER') {
      const isOwnConversation = ownerId && ownerId === user.id;
      const isUserConversation = ownerRole === 'USER';
      if (!isOwnConversation && !isUserConversation) {
        throw new ForbiddenException('Not allowed to access this conversation');
      }
      return;
    }

    if (!ownerId) {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { userId: user.id },
      });
      return;
    }

    if (ownerId !== user.id) {
      throw new ForbiddenException('Not allowed to access this conversation');
    }
  }

  private async assertConversationWriteAccess(conversationId: string, user: AuthUser) {
    if (!conversationId) return;

    const role = this.normalizeRole(user.role);
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });

    if (!conv) return;

    const ownerId = String(conv.userId || '').trim();

    if (role === 'USER') {
      if (!ownerId) {
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { userId: user.id },
        });
        return;
      }
      if (ownerId !== user.id) {
        throw new ForbiddenException('Not allowed to continue this conversation');
      }
      return;
    }

    if (!ownerId) {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { userId: user.id },
      });
      return;
    }

    if (ownerId !== user.id) {
      throw new ForbiddenException('Not allowed to continue this conversation');
    }
  }

  private normalizeRole(value?: string | null): AuthUser['role'] {
    const normalized = String(value || 'USER').toUpperCase();
    if (normalized === 'ADMIN' || normalized === 'MANAGER') {
      return normalized;
    }
    return 'USER';
  }

  private async resolveReadableMentionDocumentIds(
    mentionDocumentIds: string[],
    user: AuthUser,
    activeConversationId: string,
  ) {
    const docs = await this.prisma.document.findMany({
      where: { id: { in: mentionDocumentIds } },
      select: {
        id: true,
        originalName: true,
        conversationId: true,
        conversation: {
          select: {
            userId: true,
            user: { select: { role: true } },
          },
        },
      },
    });

    return docs
      .filter((doc) =>
        this.canReadMentionedDocument({
          viewer: user,
          documentConversationId: doc.conversationId,
          activeConversationId,
          ownerId: doc.conversation?.userId || null,
          ownerRole: doc.conversation?.user?.role || null,
        }),
      )
      .map((doc) => ({
        id: doc.id,
        name: String(doc.originalName || '').trim() || 'document',
      }));
  }

  private canReadMentionedDocument(params: {
    viewer: AuthUser;
    documentConversationId: string;
    activeConversationId: string;
    ownerId: string | null;
    ownerRole: string | null;
  }) {
    const { viewer, documentConversationId, activeConversationId, ownerId, ownerRole } = params;
    const role = this.normalizeRole(viewer.role);
    if (role === 'ADMIN') return true;

    const normalizedOwnerId = String(ownerId || '').trim();
    const normalizedOwnerRole = this.normalizeRole(ownerRole);

    if (role === 'MANAGER') {
      if (normalizedOwnerId && normalizedOwnerId === viewer.id) return true;
      return normalizedOwnerRole === 'USER';
    }

    if (normalizedOwnerId) {
      return normalizedOwnerId === viewer.id;
    }

    // For orphan conversations with no owner, allow only when it is the same active chat.
    return documentConversationId === activeConversationId;
  }

  private deriveNextState(currentState: ConversationState, route: ChatPath): ConversationState {
    if (route === 'ACTION_EXECUTION') return 'ACTION_MODE';
    if (route === 'ONBOARDING') {
      return currentState === 'NEW' ? 'ONBOARDED' : currentState;
    }
    return 'ACTIVE_TASK';
  }

  private resolvePreferredLanguage(params: {
    requestLanguage?: 'ar' | 'en';
    aiLanguage?: string;
    prompt: string;
  }): 'ar' | 'en' {
    if (params.requestLanguage === 'ar' || params.requestLanguage === 'en') {
      return params.requestLanguage;
    }
    const aiLanguage = String(params.aiLanguage || '').trim().toUpperCase();
    if (aiLanguage === 'AR') return 'ar';
    if (aiLanguage === 'EN') return 'en';
    return /[\u0600-\u06FF]/.test(params.prompt || '') ? 'ar' : 'en';
  }

  private resolveToneProfile(value: unknown): AiToneProfile {
    const normalized = String(value || '').trim().toUpperCase();
    if (
      normalized === 'DEFAULT' ||
      normalized === 'EGYPTIAN_CASUAL' ||
      normalized === 'ARABIC_FORMAL' ||
      normalized === 'ENGLISH_NEUTRAL'
    ) {
      return normalized as AiToneProfile;
    }
    return 'EGYPTIAN_CASUAL';
  }

  private safeJson(value: unknown) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private sanitizePublicSources(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const source = item as {
          objectType?: unknown;
          id?: unknown;
          snippetRef?: unknown;
        };
        return {
          objectType: String(source.objectType || '').trim(),
          id: String(source.id || '').trim(),
          snippetRef:
            source.snippetRef === null || source.snippetRef === undefined
              ? null
              : String(source.snippetRef || ''),
        };
      })
      .filter(
        (source) =>
          source.objectType &&
          source.id &&
          source.objectType.toLowerCase() !== 'routemeta',
      );
  }

  private personalizeAssistantReply(params: {
    reply: string;
    language: 'ar' | 'en';
    route: ChatPath;
    userName?: string | null;
  }) {
    const reply = String(params.reply || '').trim();
    if (!reply) return reply;
    const name = this.normalizeUserFirstName(params.userName);
    if (!name) return reply;

    if (reply.toLowerCase().includes(name.toLowerCase())) return reply;

    const shouldPersonalize =
      params.route !== 'ACTION_EXECUTION'
      || /^which path|^عايز نمشي|^في أي مسار/i.test(reply);
    if (!shouldPersonalize) return reply;

    if (params.language === 'en' && /^hello!?/i.test(reply)) {
      return `Hello ${name}! ${reply.replace(/^hello!?\s*/i, '').trim()}`;
    }
    if (params.language === 'ar' && /^(أهلا|أهلًا|أهلاً|مرحبا|مرحبًا)/i.test(reply)) {
      const trimmedGreeting = reply
        .replace(/^(أهلا|أهلًا|أهلاً|مرحبا|مرحبًا)[!،,\s]*/i, '')
        .trim();
      return `أهلاً يا ${name}${trimmedGreeting ? `، ${trimmedGreeting}` : ''}`;
    }

    if (params.language === 'ar') {
      return `أكيد يا ${name}، ${reply}`;
    }
    return `Sure ${name}, ${reply}`;
  }

  private normalizeUserFirstName(value?: string | null) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const firstToken = raw.split(/\s+/)[0] || '';
    return firstToken.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24);
  }

}
