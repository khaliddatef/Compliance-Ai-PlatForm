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
  private readonly apiKey = process.env.OPENAI_API_KEY || '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
  ) {}

  private assertConfig() {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is missing');
  }

  private async ensureUploadsDir(): Promise<string> {
    const dir = path.resolve(process.cwd(), 'uploads');
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  private async resolveStoragePath(f: Express.Multer.File): Promise<string> {
    const diskPath =
      (f as any).path ||
      ((f as any).destination && (f as any).filename
        ? `${(f as any).destination}/${(f as any).filename}`
        : undefined);

    if (diskPath) return String(diskPath);

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

  private async createVectorStore(name: string): Promise<string> {
    this.assertConfig();

    const resp = await fetch('https://api.openai.com/v1/vector_stores', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    });

    const json = await resp.json();
    if (!resp.ok) {
      console.error('[OPENAI] create vector store failed', resp.status, JSON.stringify(json)?.slice(0, 1500));
      throw new Error(`Create vector store failed: ${resp.status}`);
    }
    return json.id as string;
  }

  private async uploadFileToOpenAI(storagePath: string, originalName: string, mimeType?: string): Promise<string> {
    this.assertConfig();

    const buf = await fs.readFile(storagePath);

    const form = new FormData();
    const blob = new Blob([buf], { type: mimeType || 'application/octet-stream' });
    form.append('file', blob, originalName || path.basename(storagePath));
    form.append('purpose', 'assistants');

    const resp = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: form as any,
    });

    const json = await resp.json();
    if (!resp.ok) {
      console.error('[OPENAI] file upload failed', resp.status, JSON.stringify(json)?.slice(0, 1500));
      throw new Error(`File upload failed: ${resp.status}`);
    }

    return json.id as string;
  }

  private async attachFileToVectorStore(vectorStoreId: string, fileId: string): Promise<void> {
    this.assertConfig();

    const resp = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_id: fileId }),
    });

    const json = await resp.json();
    if (!resp.ok) {
      console.error('[OPENAI] attach file failed', resp.status, JSON.stringify(json)?.slice(0, 1500));
      throw new Error(`Attach file failed: ${resp.status}`);
    }

    console.log('[OPENAI] attached file', fileId, 'to', vectorStoreId, 'status=', json?.status);
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
    customerVectorStoreId?: string | null;
  }> {
    const { conversationId, standard, kind, files } = params;

    await this.prisma.conversation.upsert({
      where: { id: conversationId },
      create: { id: conversationId, title: 'New compliance chat' },
      update: { updatedAt: new Date() },
    });

    // Load conversation (we need customerVectorStoreId)
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    let customerVectorStoreId: string | null = (conv as any)?.customerVectorStoreId || null;

    // For CUSTOMER uploads: ensure we have a vector store
    if (kind === 'CUSTOMER' && !customerVectorStoreId) {
      console.log('[OPENAI] creating customer vector store for conversation', conversationId);
      customerVectorStoreId = await this.createVectorStore(`customer-${conversationId}`);

      // Requires prisma field Conversation.customerVectorStoreId
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { customerVectorStoreId } as any,
      });
    }

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
          } as any,
        });
      }),
    );

    // Upload CUSTOMER docs to OpenAI + attach to customer vector store
    if (kind === 'CUSTOMER') {
      console.log('[OPENAI] uploading customer files count=', documents.length, 'conv=', conversationId);

      for (const doc of documents) {
        try {
          const fileId = await this.uploadFileToOpenAI(doc.storagePath, doc.originalName, doc.mimeType);
          await this.attachFileToVectorStore(customerVectorStoreId!, fileId);
        } catch (e: any) {
          console.error('[OPENAI] customer upload/attach failed for', doc.originalName, e?.message || e);
        }
      }
    }

    // DB ingest: optional (we're canceling RAG path, so you can disable it)
    const ingestResults: IngestResult[] = [];
    const disableIngest = String(process.env.DISABLE_DB_INGEST || '').toLowerCase() === 'true';

    if (!disableIngest) {
      for (const doc of documents) {
        try {
          const res = await this.ingest.ingestDocument(doc.id);
          if (res.ok) ingestResults.push({ documentId: doc.id, ok: true, chunks: res.chunks });
          else ingestResults.push({ documentId: doc.id, ok: false, message: res.message });
        } catch (e: any) {
          ingestResults.push({ documentId: doc.id, ok: false, message: e?.message ?? 'ingest failed' });
        }
      }
    } else {
      for (const doc of documents) {
        ingestResults.push({ documentId: doc.id, ok: true, chunks: 0 });
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
      customerVectorStoreId,
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
