import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs/promises';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');

@Injectable()
export class IngestService {
  constructor(private readonly prisma: PrismaService) {}

  private chunkText(text: string, chunkSize = 1200, overlap = 200): string[] {
    const clean = (text || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!clean) return [];

    const chunks: string[] = [];
    let start = 0;

    while (start < clean.length) {
      const end = Math.min(start + chunkSize, clean.length);
      const chunk = clean.slice(start, end).trim();
      if (chunk) chunks.push(chunk);

      start = end - overlap;
      if (start < 0) start = 0;
      if (end === clean.length) break;
    }

    return chunks;
  }

  async ingestDocument(documentId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        storagePath: true,
        originalName: true,
        kind: true,
        standard: true,
        conversationId: true,
      },
    });

    if (!doc) {
      return { ok: false as const, message: 'Document not found' };
    }

    // ✅ Logs مهمة جدًا للديمو + للتأكد إن kind صح
    console.log(
      `[INGEST] doc=${doc.id} name=${doc.originalName} kind=${doc.kind} standard=${doc.standard} conv=${doc.conversationId}`,
    );

    const buffer = await fs.readFile(doc.storagePath);

    const parsed = await pdfParse(buffer);
    const text = (parsed?.text || '').trim();

    const chunks = this.chunkText(text);

    await this.prisma.$transaction(async (tx) => {
      await tx.documentChunk.deleteMany({ where: { documentId } });

      if (chunks.length > 0) {
        await tx.documentChunk.createMany({
          data: chunks.map((c, idx) => ({
            documentId,
            chunkIndex: idx,
            text: c,
          })),
        });
      }
    });

    const saved = await this.prisma.documentChunk.count({ where: { documentId } });
    console.log(`[INGEST] saved chunks=${saved} for doc=${doc.id}`);

    return { ok: true as const, chunks: chunks.length };
  }
}
