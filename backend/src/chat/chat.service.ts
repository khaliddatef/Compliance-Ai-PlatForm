import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Role = 'user' | 'assistant';
export type ComplianceStandard = 'ISO' | 'FRA' | 'CBE';

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
  constructor(private readonly prisma: PrismaService) {}

  async addMessage(params: {
    conversationId?: string;
    title?: string;
    role: Role;
    content: string;
  }) {
    const { conversationId, title, role, content } = params;

    const conv = conversationId
      ? await this.prisma.conversation.upsert({
          where: { id: conversationId },
          create: { id: conversationId, title: title || 'New compliance chat' },
          update: { updatedAt: new Date() },
        })
      : await this.prisma.conversation.create({
          data: { title: title || 'New compliance chat' },
        });

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
    standard: ComplianceStandard;
    kind: 'STANDARD' | 'CUSTOMER';
    query: string;
    topK?: number;
    maxScan?: number;
  }): Promise<RagHit[]> {
    const { conversationId, standard, kind, query, topK = 5, maxScan = 300 } = params;

    const qTokens = this.tokenize(query);
    if (qTokens.length === 0) return [];

    const rows = await this.prisma.documentChunk.findMany({
      where: {
        document: {
          conversationId,
          standard,
          kind, // ✅ important
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
