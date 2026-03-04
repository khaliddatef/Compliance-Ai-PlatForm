import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import * as fs from 'fs/promises';
import * as path from 'path';

type Role = 'user' | 'assistant';

export type RagHit = {
  documentId: string;
  docName: string;
  chunkIndex: number;
  text: string;
  score: number;
  kind: 'STANDARD' | 'CUSTOMER';
};

@Injectable()
export class ChatService implements OnModuleInit {
  private readonly defaultTitle = 'New compliance chat';

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  async addMessage(params: {
    conversationId?: string;
    title?: string;
    role: Role;
    content: string;
    userId?: string;
    messageType?: 'TEXT' | 'AI_STRUCTURED';
    cards?: unknown;
    actions?: unknown;
    sources?: unknown;
  }) {
    const { conversationId, title, role, content, userId, messageType, cards, actions, sources } = params;
    const cleanedContent = String(content || '').trim();
    const derivedTitle = role === 'user' && cleanedContent ? this.deriveTitle(cleanedContent) : '';

    let conv;

    if (conversationId) {
      const existing = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, userId: true, title: true },
      });

      if (!existing) {
        conv = await this.prisma.conversation.create({
          data: {
            id: conversationId,
            title: derivedTitle || title || this.defaultTitle,
            userId,
          },
        });
      } else {
        const shouldUpdateTitle =
          derivedTitle && (!existing.title || existing.title === this.defaultTitle);
        const nextTitle = shouldUpdateTitle ? derivedTitle : undefined;
        conv = await this.prisma.conversation.update({
          where: { id: conversationId },
          data: {
            updatedAt: new Date(),
            ...(existing.userId ? {} : { userId }),
            ...(nextTitle ? { title: nextTitle } : {}),
          },
        });
      }
    } else {
      conv = await this.prisma.conversation.create({
        data: { title: derivedTitle || title || this.defaultTitle, userId },
      });
    }

    const msg = await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        role,
        content,
        messageType: messageType || 'TEXT',
        cardsJson: cards ?? undefined,
        actionsJson: actions ?? undefined,
        sourcesJson: sources ?? undefined,
      } as any,
    });

    return { conv, msg };
  }

  private deriveTitle(content: string) {
    const cleaned = content
      .replace(/\s+/g, ' ')
      .replace(/[؟?!.,؛:]+$/g, '')
      .trim();
    if (!cleaned) return this.defaultTitle;

    const lower = cleaned.toLowerCase();
    if (lower.startsWith('uploaded') || cleaned.startsWith('تم رفع')) {
      return cleaned.startsWith('تم رفع') ? 'مراجعة ملف' : 'Document review';
    }

    const max = 32;
    if (cleaned.length <= max) return cleaned;
    return `${cleaned.slice(0, max).trim()}…`;
  }

  async listMessages(conversationId: string) {
    return this.prisma.$queryRaw<any[]>`
      SELECT
        id,
        conversationId,
        role,
        content,
        messageType,
        cardsJson,
        actionsJson,
        sourcesJson,
        createdAt
      FROM "Message"
      WHERE conversationId = ${conversationId}
      ORDER BY datetime(createdAt) ASC
    `;
  }

  // ✅ Delete conversation + dependent data (messages + docs + chunks)
  async deleteConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, customerVectorStoreId: true },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');

    const docs = await this.prisma.document.findMany({
      where: { conversationId },
      select: { openaiFileId: true, kind: true, storagePath: true },
    });

    // transaction علشان كله يتمسح مرة واحدة
    await this.prisma.$transaction(async (tx) => {
      // 1) delete messages
      await tx.message.deleteMany({ where: { conversationId } });

      // 2) delete document chunks (via documents linked to conversation)
      await tx.documentChunk.deleteMany({
        where: { document: { conversationId } },
      });

      // 3) delete documents
      await tx.document.deleteMany({ where: { conversationId } });

      // 4) finally delete conversation
      await tx.conversation.delete({ where: { id: conversationId } });
    });

    try {
      await this.uploadService.cleanupOpenAiResources({
        documents: docs,
        customerVectorStoreId: conversation.customerVectorStoreId || null,
        deleteVectorStore: true,
      });
    } catch (e: any) {
      console.error('[OPENAI] cleanup failed for conversation', conversationId, e?.message || e);
    }

    for (const doc of docs) {
      const storagePath = String(doc.storagePath || '');
      if (!storagePath) continue;
      const resolvedPath = path.isAbsolute(storagePath)
        ? storagePath
        : path.resolve(process.cwd(), storagePath);
      try {
        await fs.unlink(resolvedPath);
      } catch {
        // ignore missing file
      }
    }

    return { ok: true };
  }

  async hideConversationForUser(conversationId: string, userId: string) {
    if (!conversationId || !userId) {
      throw new NotFoundException('Conversation not found');
    }

    await this.prisma.conversationVisibility.upsert({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      update: { hidden: true },
      create: {
        conversationId,
        userId,
        hidden: true,
      },
    });

    return { ok: true };
  }

  // ----------------------------
  // RAG (Keyword) - MVP Retrieval
  // ----------------------------

  private stopWords = new Set([
    'the','a','an','and','or','to','of','in','on','for','with','is','are','was','were','be','as','at','by','from','that','this','it','you','your','we','our','they','their',
    'في','من','على','الى','إلى','عن','و','او','أو','ده','دي','هذا','هذه',
  ]);

  private tokenize(text: string): string[] {
    return (text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !this.stopWords.has(t));
  }

  private scoreChunk(queryTokens: string[], chunkText: string): number {
    const hay = (chunkText || '').toLowerCase();
    let score = 0;

    for (const tok of queryTokens) {
      const re = new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const matches = hay.match(re);
      if (matches?.length) score += Math.min(5, matches.length);
    }

    if (chunkText && chunkText.length < 900) score += 1;
    return score;
  }

  async retrieveTopChunks(params: {
    conversationId: string;
    kind: 'STANDARD' | 'CUSTOMER';
    query: string;
    topK?: number;
    maxScan?: number;
  }): Promise<RagHit[]> {
    const { conversationId, kind, query, topK = 5, maxScan = 300 } = params;

    const qTokens = this.tokenize(query);
    if (qTokens.length === 0) return [];

    const rows = await this.prisma.documentChunk.findMany({
      where: {
        document: {
          conversationId,
          kind,
        },
      },
      include: { document: true },
      orderBy: { createdAt: 'desc' },
      take: maxScan,
    });

    return rows
      .map((r) => ({
        documentId: r.documentId,
        docName: r.document?.originalName ?? 'document',
        chunkIndex: r.chunkIndex,
        text: r.text,
        score: this.scoreChunk(qTokens, r.text),
        kind,
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async retrieveLatestDocumentChunks(params: {
    conversationId: string;
    kind: 'STANDARD' | 'CUSTOMER';
    topK?: number;
  }): Promise<RagHit[]> {
    const { conversationId, kind, topK = 12 } = params;

    const latestDoc = await this.prisma.document.findFirst({
      where: { conversationId, kind },
      orderBy: { createdAt: 'desc' },
      select: { id: true, originalName: true },
    });
    if (!latestDoc) return [];

    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId: latestDoc.id },
      orderBy: { chunkIndex: 'asc' },
      take: topK,
      select: { documentId: true, chunkIndex: true, text: true },
    });

    return chunks
      .map((chunk, idx) => ({
        documentId: chunk.documentId,
        docName: latestDoc.originalName || 'document',
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        // keep deterministic descending score so earlier chunks are preferred.
        score: Math.max(1, topK - idx),
        kind,
      }))
      .filter((item) => String(item.text || '').trim().length > 0);
  }

  async retrieveChunksByDocumentIds(params: {
    kind?: 'STANDARD' | 'CUSTOMER';
    documentIds: string[];
    query: string;
    topK?: number;
  }): Promise<RagHit[]> {
    const { query, topK = 10, kind = 'CUSTOMER' } = params;
    const requestedIds = Array.isArray(params.documentIds)
      ? params.documentIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (!requestedIds.length) return [];

    const uniqueIds = Array.from(new Set(requestedIds));
    const docPriority = new Map(uniqueIds.map((id, index) => [id, index]));

    const docs = await this.prisma.document.findMany({
      where: {
        id: { in: uniqueIds },
        kind,
      },
      select: {
        id: true,
        originalName: true,
      },
    });
    if (!docs.length) return [];

    const existingDocIds = docs.map((doc) => doc.id);
    const docNameById = new Map(docs.map((doc) => [doc.id, doc.originalName || 'document']));
    const queryTokens = this.tokenize(query);
    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId: { in: existingDocIds } },
      select: {
        documentId: true,
        chunkIndex: true,
        text: true,
      },
      orderBy: [{ chunkIndex: 'asc' }],
      take: 400,
    });
    if (!chunks.length) return [];

    const ranked = chunks
      .map((chunk) => ({
        documentId: chunk.documentId,
        docName: docNameById.get(chunk.documentId) || 'document',
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        score:
          queryTokens.length > 0
            ? this.scoreChunk(queryTokens, chunk.text)
            : 0,
        kind,
        priority: docPriority.get(chunk.documentId) ?? Number.MAX_SAFE_INTEGER,
      }))
      .filter((item) => String(item.text || '').trim().length > 0);

    const withMatches = ranked
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.chunkIndex - b.chunkIndex;
      })
      .slice(0, topK)
      .map(({ priority, ...item }) => item);

    if (withMatches.length) return withMatches;

    return ranked
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.chunkIndex - b.chunkIndex;
      })
      .slice(0, topK)
      .map(({ priority, ...item }, index) => ({
        ...item,
        score: Math.max(1, topK - index),
      }));
  }

  private async ensureSchema() {
    await this.prisma.$executeRawUnsafe(`
      ALTER TABLE "Message" ADD COLUMN messageType TEXT NOT NULL DEFAULT 'TEXT'
    `).catch(() => undefined);
    await this.prisma.$executeRawUnsafe(`
      ALTER TABLE "Message" ADD COLUMN cardsJson JSON
    `).catch(() => undefined);
    await this.prisma.$executeRawUnsafe(`
      ALTER TABLE "Message" ADD COLUMN actionsJson JSON
    `).catch(() => undefined);
    await this.prisma.$executeRawUnsafe(`
      ALTER TABLE "Message" ADD COLUMN sourcesJson JSON
    `).catch(() => undefined);
  }
}
