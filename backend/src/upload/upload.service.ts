import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IngestService } from '../ingest/ingest.service';
import * as fs from 'fs/promises';
import * as path from 'path';

type DocKind = 'CUSTOMER' | 'STANDARD';

type IngestResult =
  | { documentId: string; ok: true; chunks: number }
  | { documentId: string; ok: false; message: string };

@Injectable()
export class UploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
  ) {}

  private async ensureUploadsDir(): Promise<string> {
    // خليها زي ما انت مستخدم في مشروعك لو عندك فولدر uploads ثابت
    const dir = path.resolve(process.cwd(), 'uploads');
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  private async resolveStoragePath(f: Express.Multer.File): Promise<string> {
    // Case 1: diskStorage (path موجود)
    const diskPath =
      (f as any).path ||
      ((f as any).destination && (f as any).filename
        ? `${(f as any).destination}/${(f as any).filename}`
        : undefined);

    if (diskPath) return String(diskPath);

    // Case 2: memoryStorage (buffer موجود)
    const buf = (f as any).buffer as Buffer | undefined;
    if (!buf || !Buffer.isBuffer(buf)) {
      throw new Error(
        'Multer file has no path and no buffer. Check Multer config + Postman form-data key.',
      );
    }

    const uploadsDir = await this.ensureUploadsDir();
    const safeName = (f.originalname || 'file.pdf').replace(/[^\w.\-]+/g, '_');
    const filename = `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeName}`;
    const fullPath = path.join(uploadsDir, filename);

    await fs.writeFile(fullPath, buf);
    return fullPath;
  }

  async saveUploadedFiles(params: {
    conversationId: string;
    standard: string;
    kind: DocKind;
    files: Express.Multer.File[];
  }): Promise<{
    ok: true;
    conversationId: string;
    standard: string;
    kind: DocKind;
    count: number;
    documents: any[];
    ingestResults: IngestResult[];
  }> {
    const { conversationId, standard, kind, files } = params;

    await this.prisma.conversation.upsert({
      where: { id: conversationId },
      create: { id: conversationId, title: 'New compliance chat' },
      update: { updatedAt: new Date() },
    });

    const documents = await Promise.all(
      files.map(async (f) => {
        const storagePath = await this.resolveStoragePath(f);

        return this.prisma.document.create({
          data: {
            conversationId,
            standard,
            kind,
            originalName: f.originalname,
            mimeType: f.mimetype,
            sizeBytes: f.size,
            storagePath,
          },
        });
      }),
    );

    const ingestResults: IngestResult[] = [];
    for (const doc of documents) {
      try {
        const res = await this.ingest.ingestDocument(doc.id);
        if (res.ok) {
          ingestResults.push({ documentId: doc.id, ok: true, chunks: res.chunks });
        } else {
          ingestResults.push({ documentId: doc.id, ok: false, message: res.message });
        }
      } catch (e: any) {
        ingestResults.push({
          documentId: doc.id,
          ok: false,
          message: e?.message ?? 'ingest failed',
        });
      }
    }

    return {
      ok: true,
      conversationId,
      standard,
      kind,
      count: documents.length,
      documents,
      ingestResults,
    };
  }

  listByConversation(params: {
    conversationId: string;
    standard?: string;
    kind?: DocKind;
  }) {
    const { conversationId, standard, kind } = params;

    return this.prisma.document.findMany({
      where: {
        conversationId,
        ...(standard ? { standard } : {}),
        ...(kind ? { kind } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
