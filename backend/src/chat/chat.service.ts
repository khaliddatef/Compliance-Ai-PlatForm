import { Injectable, NotFoundException } from '@nestjs/common';
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
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async addMessage(params: {
    conversationId?: string;
    title?: string;
    role: Role;
    content: string;
    userId?: string;
  }) {
    const { conversationId, title, role, content, userId } = params;

    let conv;

    if (conversationId) {
      const existing = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, userId: true },
      });

      if (!existing) {
        conv = await this.prisma.conversation.create({
          data: { id: conversationId, title: title || 'New compliance chat', userId },
        });
      } else {
        conv = await this.prisma.conversation.update({
          where: { id: conversationId },
          data: {
            updatedAt: new Date(),
            ...(existing.userId ? {} : { userId }),
          },
        });
      }
    } else {
      conv = await this.prisma.conversation.create({
        data: { title: title || 'New compliance chat', userId },
      });
    }

    const msg = await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        role,
        content,
      },
    });

    return { conv, msg };
  }

  async listMessages(conversationId: string) {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
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
}
