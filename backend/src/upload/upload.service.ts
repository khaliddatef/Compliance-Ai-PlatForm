import { ForbiddenException, GoneException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IngestService } from '../ingest/ingest.service';
import { AgentService } from '../agent/agent.service';
import type { ControlCandidate } from '../agent/agent.service';
import * as fs from 'fs/promises';
import * as path from 'path';

type DocKind = 'CUSTOMER' | 'STANDARD';

type IngestResult =
  | { documentId: string; ok: true; chunks: number }
  | { documentId: string; ok: false; message: string };

type EvidenceEvalRow = {
  conversationId: string;
  controlId: string;
  status: string;
  summary: string;
  citations: unknown;
  createdAt: Date;
};

@Injectable()
export class UploadService {
  private readonly apiKey = process.env.OPENAI_API_KEY || '';
  private readonly disableOpenAiStorage =
    String(process.env.DISABLE_OPENAI_STORAGE || '').toLowerCase() === 'true';

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
    private readonly agent: AgentService,
  ) {}

  private assertConfig() {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is missing');
  }

  private hasOpenAiConfig() {
    return !!this.apiKey;
  }

  private shouldUseOpenAiStorage() {
    return this.hasOpenAiConfig() && !this.disableOpenAiStorage;
  }

  private buildNoCandidateControlOutcome(language?: 'ar' | 'en') {
    const isArabic = language === 'ar';
    return {
      matchStatus: 'UNKNOWN' as const,
      matchControlId: null as string | null,
      matchNote: isArabic
        ? 'لم يتم العثور على Candidate Control ضمن جميع الكنترولات المفعلة (enabled controls).'
        : 'No candidate control found in all enabled controls.',
      matchRecommendations: isArabic
        ? [
            'أضف الكنترول المناسب أو اربطه في Control KB ثم أعد التقييم.',
            'حسّن اسم الملف أو المحتوى ليعكس سياق الكنترول بشكل أوضح.',
          ]
        : [
            'Add or map the relevant control in Control KB, then re-evaluate this document.',
            'Refine the file name/content so control context is clearer.',
          ],
    };
  }

  private normalizeControlCode(value: string) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private extractControlCodeHints(fileName: string) {
    const raw = String(fileName || '')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-')
      .replace(/\s*([._-])\s*/g, '$1');
    const matches = raw.match(/\b[A-Za-z]{2,}(?:[-_][A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)+\b/g) || [];
    return Array.from(
      new Set(
        matches
          .map((value) => value.trim())
          .map((value) => {
            const parts = value.split(/[-_]/).filter(Boolean);
            while (parts.length > 1 && !/\d/.test(parts[parts.length - 1])) {
              parts.pop();
            }
            return parts.join('-');
          })
          .filter((value) => /[a-z]/i.test(value) && /\d/.test(value))
          .filter((value) => !/^v?\d+(?:\.\d+)+$/i.test(value))
          .map((value) => this.normalizeControlCode(value))
          .filter((value) => value.length >= 5)
          .filter(Boolean),
      ),
    );
  }

  private controlCodeMatchesHint(controlCode: string, hint: string) {
    const normalizedControlCode = this.normalizeControlCode(controlCode);
    if (!normalizedControlCode || !hint) return false;
    if (normalizedControlCode === hint) return true;
    if (Math.min(normalizedControlCode.length, hint.length) < 5) return false;
    return (
      normalizedControlCode.startsWith(hint) ||
      normalizedControlCode.endsWith(hint) ||
      hint.startsWith(normalizedControlCode) ||
      hint.endsWith(normalizedControlCode)
    );
  }

  private async attachControlTitles<T extends { matchControlId?: string | null }>(docs: T[]) {
    if (!docs?.length) return docs;
    const controlCodes = Array.from(
      new Set(
        docs
          .map((doc) => String(doc?.matchControlId || '').trim())
          .filter(Boolean),
      ),
    );

    if (!controlCodes.length) {
      return docs.map((doc) => ({ ...doc, matchControlTitle: null }));
    }

    const controls = await this.prisma.controlDefinition.findMany({
      where: { controlCode: { in: controlCodes } },
      select: { controlCode: true, title: true },
    });
    const titleByCode = new Map<string, string>();
    controls.forEach((control) => {
      const code = String(control.controlCode || '').trim();
      const title = String(control.title || '').trim();
      const normalizedCode = this.normalizeControlCode(code);
      if (!code || !title) return;
      titleByCode.set(code, title);
      if (normalizedCode) titleByCode.set(normalizedCode, title);
    });

    const unresolvedCodes = controlCodes.filter((code) => {
      const normalized = this.normalizeControlCode(code);
      return !titleByCode.has(code) && !titleByCode.has(normalized);
    });

    if (unresolvedCodes.length) {
      const mappedControls = await this.prisma.controlDefinition.findMany({
        where: {
          frameworkMappings: {
            some: {
              frameworkCode: { in: unresolvedCodes },
            },
          },
        },
        select: {
          title: true,
          frameworkMappings: { select: { frameworkCode: true } },
        },
      });

      mappedControls.forEach((control) => {
        const title = String(control.title || '').trim();
        if (!title) return;
        (control.frameworkMappings || []).forEach((mapping) => {
          const frameworkCode = String(mapping.frameworkCode || '').trim();
          if (!frameworkCode) return;
          const normalizedFrameworkCode = this.normalizeControlCode(frameworkCode);
          titleByCode.set(frameworkCode, title);
          if (normalizedFrameworkCode) titleByCode.set(normalizedFrameworkCode, title);
        });
      });
    }

    return docs.map((doc) => {
      const controlCode = String(doc?.matchControlId || '').trim();
      const normalizedControlCode = this.normalizeControlCode(controlCode);
      const title = controlCode
        ? titleByCode.get(controlCode) || titleByCode.get(normalizedControlCode) || null
        : null;
      return { ...doc, matchControlTitle: title };
    });
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

  private async getVectorStoreFileStatus(vectorStoreId: string, fileId: string): Promise<string | null> {
    this.assertConfig();

    const resp = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${fileId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!resp.ok) {
      const json = await resp.json().catch(() => null);
      console.error('[OPENAI] vector store file status failed', resp.status, JSON.stringify(json)?.slice(0, 1500));
      return null;
    }

    const json = await resp.json().catch(() => null);
    const status = String(json?.status || '').toLowerCase();
    return status || null;
  }

  private async waitForVectorStoreFileReady(
    vectorStoreId: string,
    fileId: string,
    opts: { timeoutMs?: number; intervalMs?: number } = {},
  ) {
    const timeoutMs = opts.timeoutMs ?? 45000;
    const intervalMs = opts.intervalMs ?? 1500;
    const start = Date.now();
    let lastStatus = '';

    while (Date.now() - start < timeoutMs) {
      const status = await this.getVectorStoreFileStatus(vectorStoreId, fileId);
      if (status) lastStatus = status;

      if (status === 'completed' || status === 'ready') {
        return { ok: true, status };
      }
      if (status === 'failed' || status === 'cancelled' || status === 'expired') {
        return { ok: false, status };
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return { ok: false, status: lastStatus || 'timeout' };
  }

  private async detachFileFromVectorStore(vectorStoreId: string, fileId: string): Promise<void> {
    this.assertConfig();

    const resp = await fetch(
      `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${fileId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      },
    );

    if (!resp.ok) {
      const json = await resp.json().catch(() => null);
      console.error('[OPENAI] detach file failed', resp.status, JSON.stringify(json)?.slice(0, 1500));
      throw new Error(`Detach file failed: ${resp.status}`);
    }
  }

  private async deleteOpenAiFile(fileId: string): Promise<void> {
    this.assertConfig();

    const resp = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!resp.ok) {
      const json = await resp.json().catch(() => null);
      console.error('[OPENAI] delete file failed', resp.status, JSON.stringify(json)?.slice(0, 1500));
      throw new Error(`Delete file failed: ${resp.status}`);
    }
  }

  private async deleteVectorStore(vectorStoreId: string): Promise<void> {
    this.assertConfig();

    const resp = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!resp.ok) {
      const json = await resp.json().catch(() => null);
      console.error('[OPENAI] delete vector store failed', resp.status, JSON.stringify(json)?.slice(0, 1500));
      throw new Error(`Delete vector store failed: ${resp.status}`);
    }
  }

  async saveUploadedFiles(params: {
    conversationId: string;
    kind: DocKind;
    files: Express.Multer.File[];
    user: { id: string; role: string };
    language?: 'ar' | 'en';
  }): Promise<{
    ok: true;
    conversationId: string;
    kind: DocKind;
    count: number;
    documents: any[];
    ingestResults: IngestResult[];
    customerVectorStoreId?: string | null;
  }> {
    const { conversationId, kind, files, user, language } = params;
    if (kind === 'STANDARD') {
      throw new GoneException('Standard uploads are disabled. The KB is the source of truth.');
    }

    const existingConversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true },
    });

    if (existingConversation?.userId && user.role === 'USER' && existingConversation.userId !== user.id) {
      throw new ForbiddenException('Not allowed to upload to this conversation');
    }

    if (!existingConversation) {
      await this.prisma.conversation.create({
        data: { id: conversationId, title: 'New compliance chat', userId: user.id },
      });
    } else if (!existingConversation.userId) {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { userId: user.id, updatedAt: new Date() },
      });
    } else {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
    }

    // Load conversation (we need customerVectorStoreId)
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    let customerVectorStoreId: string | null = (conv as any)?.customerVectorStoreId || null;

    const allowOpenAiStorage = this.shouldUseOpenAiStorage();
    console.log(
      '[OPENAI] storage enabled=',
      allowOpenAiStorage,
      'DISABLE_OPENAI_STORAGE=',
      process.env.DISABLE_OPENAI_STORAGE,
      'ENABLE_OPENAI_STORAGE=',
      process.env.ENABLE_OPENAI_STORAGE,
    );

    // For CUSTOMER uploads: ensure we have a vector store (only when enabled)
    if (kind === 'CUSTOMER' && allowOpenAiStorage && !customerVectorStoreId) {
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
            kind,
            originalName: f.originalname,
            mimeType: f.mimetype,
            sizeBytes: f.size,
            storagePath,
          } as any,
        });
      }),
    );

    const attachToVectorStore = async (doc: any, vectorStoreId: string, label: string) => {
      try {
        const fileId = await this.uploadFileToOpenAI(doc.storagePath, doc.originalName, doc.mimeType);
        await this.attachFileToVectorStore(vectorStoreId, fileId);
        await this.prisma.document.update({
          where: { id: doc.id },
          data: { openaiFileId: fileId },
        });
        doc.openaiFileId = fileId;
      } catch (e: any) {
        console.error(`[OPENAI] ${label} upload/attach failed for`, doc.originalName, e?.message || e);
      }
    };

    if (kind === 'CUSTOMER' && allowOpenAiStorage && customerVectorStoreId) {
      console.log('[OPENAI] uploading customer files count=', documents.length, 'conv=', conversationId);
      for (const doc of documents) {
        await attachToVectorStore(doc, customerVectorStoreId, 'customer');
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

    let analyzedDocs = documents;

    if (kind === 'CUSTOMER') {
      for (const doc of documents) {
        try {
          const extractedText = String((await this.getDocumentExcerpt(doc.id)) || '').trim();
          console.log('[DOC MATCH] document text chars=', extractedText.length, 'doc=', doc.id, 'name=', doc.originalName);
          if (!extractedText) {
            const noTextNote =
              language === 'ar'
                ? 'لم يتم استخراج نص قابل للقراءة من هذا الملف.'
                : 'No readable text was extracted from this file.';
            const noTextRecs =
              language === 'ar'
                ? ['ارفع نسخة أوضح بصيغة PDF/DOCX أو أضف سياقًا أكثر.']
                : ['Upload a clearer PDF/DOCX or provide more context.'];
            await this.prisma.document.update({
              where: { id: doc.id },
              data: {
                matchStatus: 'UNKNOWN',
                matchNote: noTextNote,
                matchRecommendations: noTextRecs,
                reviewedAt: new Date(),
              } as any,
            });
            continue;
          }

          const candidates = await this.findControlCandidates(doc.originalName || '', extractedText);
          if (!candidates.length) {
            const noCandidate = this.buildNoCandidateControlOutcome(language);
            await this.prisma.document.update({
              where: { id: doc.id },
              data: {
                matchControlId: noCandidate.matchControlId,
                matchStatus: noCandidate.matchStatus,
                matchNote: noCandidate.matchNote,
                matchRecommendations: noCandidate.matchRecommendations,
                reviewedAt: new Date(),
              } as any,
            });
            continue;
          }

          const activeFramework = await this.getActiveFrameworkLabel();
          const analysis = await this.agent.analyzeCustomerDocument({
            framework: activeFramework,
            fileName: doc.originalName,
            content: extractedText,
            language,
            controlCandidates: candidates,
          });

          await this.prisma.document.update({
            where: { id: doc.id },
            data: {
              docType: analysis.docType,
              matchControlId: analysis.matchControlId,
              matchStatus: analysis.matchStatus,
              matchNote: analysis.matchNote,
              matchRecommendations: analysis.matchRecommendations,
              reviewedAt: new Date(),
            } as any,
          });
        } catch (e: any) {
          console.error('[DOC MATCH] failed for', doc.originalName, e?.message || e);
        }
      }

      analyzedDocs = await this.prisma.document.findMany({
        where: { id: { in: documents.map((doc) => doc.id) } },
        include: { conversation: { select: { title: true } }, _count: { select: { chunks: true } } },
      });
    }

    const documentsWithReferences = await this.attachFrameworkReferences(analyzedDocs);
    const documentsWithTitles = await this.attachControlTitles(documentsWithReferences);

    return {
      ok: true,
      conversationId,
      kind,
      count: documents.length,
      documents: documentsWithTitles,
      ingestResults,
      customerVectorStoreId,
    };
  }

  async listByConversation(params: {
    conversationId: string;
    kind?: DocKind;
    user?: { id: string; role: string };
  }) {
    const { conversationId, kind, user } = params;

    if (user && user.role === 'USER') {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { userId: true },
      });
      if (!conv) {
        return [];
      }
      if (!conv.userId) {
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { userId: user.id },
        });
      } else if (conv.userId !== user.id) {
        return [];
      }
    }

    const docs = await this.prisma.document.findMany({
      where: {
        conversationId,
        ...(kind ? { kind } : {}),
      },
      include: {
        _count: { select: { chunks: true } },
        conversation: { select: { title: true, user: { select: { name: true, email: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const withHints = await this.attachEvaluationHints(docs);
    const withRefs = await this.attachFrameworkReferences(withHints);
    return this.attachControlTitles(withRefs);
  }

  async listAllForUser(user?: { id: string; role: string }) {
    const isUser = user?.role === 'USER';
    const docs = await this.prisma.document.findMany({
      where: isUser
        ? { conversation: { userId: user?.id } }
        : undefined,
      include: {
        _count: { select: { chunks: true } },
        conversation: { select: { title: true, user: { select: { name: true, email: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const withHints = await this.attachEvaluationHints(docs);
    const withRefs = await this.attachFrameworkReferences(withHints);
    return this.attachControlTitles(withRefs);
  }

  getDocumentById(id: string) {
    return this.prisma.document.findUnique({ where: { id } });
  }

  async getDocumentDetails(id: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: {
        _count: { select: { chunks: true } },
        conversation: { select: { userId: true, title: true, user: { select: { name: true, email: true } } } },
      },
    });
    if (!doc) return null;

    const withHints = await this.attachEvaluationHints([doc]);
    const withRefs = await this.attachFrameworkReferences(withHints);
    const withTitles = await this.attachControlTitles(withRefs);
    return withTitles[0] || withRefs[0] || withHints[0] || doc;
  }

  getDocumentWithOwner(id: string) {
    return this.prisma.document.findUnique({
      where: { id },
      include: { conversation: { select: { userId: true } } },
    });
  }

  async reevaluateDocument(id: string, language?: 'ar' | 'en') {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: {
        conversation: { select: { title: true, customerVectorStoreId: true } },
        _count: { select: { chunks: true } },
      },
    });
    if (!doc) return null;

    const extractedText = String((await this.getDocumentExcerpt(doc.id)) || '').trim();
    if (!extractedText) {
      const noTextNote =
        language === 'ar'
          ? 'لم يتم استخراج نص قابل للقراءة من هذا الملف.'
          : 'No readable text was extracted from this file.';
      const noTextRecs =
        language === 'ar'
          ? ['ارفع نسخة أوضح بصيغة PDF/DOCX أو أضف سياقًا أكثر.']
          : ['Upload a clearer PDF/DOCX or provide more context.'];
      const pending = await this.prisma.document.update({
        where: { id: doc.id },
        data: {
          matchStatus: 'UNKNOWN',
          matchNote: noTextNote,
          matchRecommendations: noTextRecs,
          reviewedAt: new Date(),
        } as any,
        include: {
          conversation: { select: { title: true } },
          _count: { select: { chunks: true } },
        },
      });
      const withRefs = await this.attachFrameworkReferences([pending]);
      const withTitles = await this.attachControlTitles(withRefs);
      return withTitles[0] || withRefs[0] || pending;
    }

    const candidates = await this.findControlCandidates(doc.originalName || '', extractedText);
    if (!candidates.length) {
      const noCandidate = this.buildNoCandidateControlOutcome(language);
      const pending = await this.prisma.document.update({
        where: { id: doc.id },
        data: {
          matchControlId: noCandidate.matchControlId,
          matchStatus: noCandidate.matchStatus,
          matchNote: noCandidate.matchNote,
          matchRecommendations: noCandidate.matchRecommendations,
          reviewedAt: new Date(),
        } as any,
        include: {
          conversation: { select: { title: true } },
          _count: { select: { chunks: true } },
        },
      });
      const withRefs = await this.attachFrameworkReferences([pending]);
      const withTitles = await this.attachControlTitles(withRefs);
      return withTitles[0] || withRefs[0] || pending;
    }

    const activeFramework = await this.getActiveFrameworkLabel();

    const analysis = await this.agent.analyzeCustomerDocument({
      framework: activeFramework,
      fileName: doc.originalName,
      content: extractedText,
      language,
      controlCandidates: candidates,
    });

    const updated = await this.prisma.document.update({
      where: { id: doc.id },
      data: {
        docType: analysis.docType,
        matchControlId: analysis.matchControlId,
        matchStatus: analysis.matchStatus,
        matchNote: analysis.matchNote,
        matchRecommendations: analysis.matchRecommendations,
        reviewedAt: new Date(),
      } as any,
      include: {
        conversation: { select: { title: true } },
        _count: { select: { chunks: true } },
      },
    });

    const withRefs = await this.attachFrameworkReferences([updated]);
    const withTitles = await this.attachControlTitles(withRefs);
    return withTitles[0] || withRefs[0] || updated;
  }

  async deleteDocument(id: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: { conversation: { select: { customerVectorStoreId: true } } },
    });
    if (!doc) return null;

    await this.prisma.document.delete({ where: { id } });

    const resolvedPath = path.isAbsolute(doc.storagePath)
      ? doc.storagePath
      : path.resolve(process.cwd(), doc.storagePath);

    try {
      await fs.unlink(resolvedPath);
    } catch {
      // ignore missing file
    }

    try {
      await this.cleanupOpenAiResources({
        documents: [doc],
        customerVectorStoreId: doc.conversation?.customerVectorStoreId || null,
      });
    } catch (e: any) {
      console.error('[OPENAI] cleanup failed for doc', doc.id, e?.message || e);
    }

    return doc;
  }

  async updateDocumentStatus(id: string, status: 'REVIEWED' | 'SUBMITTED') {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: {
        conversation: { select: { title: true, user: { select: { name: true, email: true } } } },
        _count: { select: { chunks: true } },
      },
    });
    if (!doc) return null;

    const now = new Date();
    const data: any = { reviewedAt: doc.reviewedAt };
    if (status === 'REVIEWED') {
      data.reviewedAt = now;
      data.submittedAt = null;
    }
    if (status === 'SUBMITTED') {
      data.submittedAt = now;
      if (!doc.reviewedAt) data.reviewedAt = now;
    }

    const updated = await this.prisma.document.update({
      where: { id },
      data,
      include: {
        conversation: { select: { title: true, user: { select: { name: true, email: true } } } },
        _count: { select: { chunks: true } },
      },
    });

    const withRefs = await this.attachFrameworkReferences([updated]);
    const withTitles = await this.attachControlTitles(withRefs);
    return withTitles[0] || withRefs[0] || updated;
  }

  async updateDocumentMatchStatus(
    id: string,
    matchStatus: 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN',
  ) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: {
        conversation: { select: { title: true, user: { select: { name: true, email: true } } } },
        _count: { select: { chunks: true } },
      },
    });
    if (!doc) return null;

    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        matchStatus,
        reviewedAt: new Date(),
      },
      include: {
        conversation: { select: { title: true, user: { select: { name: true, email: true } } } },
        _count: { select: { chunks: true } },
      },
    });

    const withRefs = await this.attachFrameworkReferences([updated]);
    const withTitles = await this.attachControlTitles(withRefs);
    return withTitles[0] || withRefs[0] || updated;
  }

  async cleanupOpenAiResources(params: {
    documents: Array<{
      openaiFileId?: string | null;
      kind: string;
    }>;
    customerVectorStoreId?: string | null;
    deleteVectorStore?: boolean;
  }) {
    if (!this.hasOpenAiConfig()) {
      return;
    }

    const documents = Array.isArray(params.documents) ? params.documents : [];
    for (const doc of documents) {
      const fileId = doc.openaiFileId;
      if (!fileId) continue;

      let vectorStoreId: string | null = null;
      const kind = String(doc.kind || '').toUpperCase();
      if (kind === 'CUSTOMER') {
        vectorStoreId = params.customerVectorStoreId || null;
      }

      if (vectorStoreId) {
        try {
          await this.detachFileFromVectorStore(vectorStoreId, fileId);
        } catch (e: any) {
          console.error('[OPENAI] detach failed for file', fileId, e?.message || e);
        }
      }

      try {
        await this.deleteOpenAiFile(fileId);
      } catch (e: any) {
        console.error('[OPENAI] delete failed for file', fileId, e?.message || e);
      }
    }

    if (params.deleteVectorStore && params.customerVectorStoreId) {
      try {
        await this.deleteVectorStore(params.customerVectorStoreId);
      } catch (e: any) {
        console.error('[OPENAI] delete vector store failed', e?.message || e);
      }
    }
  }

  async ensureDocsAccess(documentIds: string[], user: { id: string; role: string }) {
    if (user.role !== 'USER') return true;
    if (!documentIds.length) return false;

    const docs = await this.prisma.document.findMany({
      where: { id: { in: documentIds } },
      include: { conversation: { select: { userId: true } } },
    });

    if (docs.length !== documentIds.length) return false;

    for (const doc of docs) {
      if (!doc.conversation?.userId) {
        await this.prisma.conversation.update({
          where: { id: doc.conversationId },
          data: { userId: user.id },
        });
        continue;
      }

      if (doc.conversation.userId !== user.id) {
        return false;
      }
    }

    return true;
  }

  async submitEvidence(params: {
    documentIds: string[];
    controlId: string;
    status: 'COMPLIANT' | 'PARTIAL';
    note?: string;
  }) {
    const documentIds = Array.from(new Set(params.documentIds.filter(Boolean)));
    if (!documentIds.length) {
      return { ok: false as const, message: 'No documents provided' };
    }

    const controlId = String(params.controlId || '').trim();
    if (!controlId) {
      return { ok: false as const, message: 'controlId is required' };
    }

    const status = params.status;
    if (status !== 'COMPLIANT' && status !== 'PARTIAL') {
      return { ok: false as const, message: 'status must be COMPLIANT or PARTIAL' };
    }

    const now = new Date();

    const updates = await Promise.all(
      documentIds.map(async (id) =>
        this.prisma.document.update({
          where: { id },
          data: {
            matchControlId: controlId,
            matchStatus: status,
            matchNote: params.note || undefined,
            reviewedAt: now,
            submittedAt: now,
          } as any,
        }),
      ),
    );

    return { ok: true as const, count: updates.length, documents: updates };
  }

  private normalizeName(name: string) {
    return (name || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .trim();
  }

  private isNameMatch(docName: string, candidate: string) {
    const normalizedDoc = this.normalizeName(docName);
    const normalizedCandidate = this.normalizeName(candidate);
    if (!normalizedDoc || !normalizedCandidate) return false;
    return normalizedDoc.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedDoc);
  }

  private findMatchingEvaluation(docName: string, evals: EvidenceEvalRow[]) {
    for (const evaluation of evals) {
      const citations = Array.isArray(evaluation.citations) ? evaluation.citations : [];
      for (const citation of citations as any[]) {
        const citedName = String(citation?.doc || '');
        if (this.isNameMatch(docName, citedName)) return evaluation;
      }
    }
    return null;
  }

  private async attachEvaluationHints(docs: any[]) {
    if (!docs?.length) return docs;

    const conversationIds = Array.from(
      new Set(docs.map((doc) => doc.conversationId).filter(Boolean)),
    );

    const evaluations: EvidenceEvalRow[] = await this.prisma.evidenceEvaluation.findMany({
      where: { conversationId: { in: conversationIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        conversationId: true,
        controlId: true,
        status: true,
        summary: true,
        citations: true,
        createdAt: true,
      },
    });

    const evalsByConversation = new Map<string, EvidenceEvalRow[]>();
    for (const evaluation of evaluations) {
      const list = evalsByConversation.get(evaluation.conversationId) || [];
      list.push(evaluation);
      evalsByConversation.set(evaluation.conversationId, list);
    }

    return docs.map((doc) => {
      if (doc.matchStatus) {
        const normalized = String(doc.matchStatus).toUpperCase();
        return {
          ...doc,
          matchStatus: normalized,
          matchNote: doc.matchNote || this.defaultMatchNote(normalized),
        };
      }

      const evals = evalsByConversation.get(doc.conversationId) || [];
      const match = this.findMatchingEvaluation(doc.originalName || '', evals);

      if (match) {
        return {
          ...doc,
          matchControlId: match.controlId,
          matchStatus: match.status,
          matchNote: match.summary,
        };
      }

      if (evals.length) {
        return {
          ...doc,
          matchControlId: null,
          matchStatus: 'UNMATCHED',
          matchNote: 'Not referenced in the latest evidence review.',
        };
      }

      return {
        ...doc,
        matchControlId: null,
        matchStatus: 'PENDING',
        matchNote: 'No evidence review has been run for this chat yet.',
      };
    });
  }

  private async attachFrameworkReferences(docs: any[]) {
    if (!docs?.length) return docs;

    const docsWithControl = docs.filter((doc) => doc?.matchControlId);
    if (!docsWithControl.length) return docs;

    const activeFrameworks = await this.getActiveFrameworkSet();

    const controlCodes = Array.from(
      new Set(docsWithControl.map((doc) => String(doc.matchControlId)).filter(Boolean)),
    );
    if (!controlCodes.length) return docs;

    const controls = await this.prisma.controlDefinition.findMany({
      where: {
        controlCode: { in: controlCodes },
      },
      select: {
        controlCode: true,
        isoMappings: true,
        frameworkMappings: {
          select: {
            framework: true,
            frameworkCode: true,
            frameworkRef: { select: { version: true } },
          },
        },
      },
    });

    const controlMap = new Map<
      string,
      {
        frameworkMappings: Array<{
          framework: string;
          frameworkCode: string;
          frameworkRef?: { version?: string | null } | null;
        }>;
        isoMappings?: unknown;
      }
    >();
    for (const control of controls) {
      controlMap.set(String(control.controlCode), {
        frameworkMappings: control.frameworkMappings || [],
        isoMappings: control.isoMappings,
      });
    }

    return docs.map((doc) => {
      const controlCode = String(doc.matchControlId || '');
      if (!controlCode) return doc;

      const control = controlMap.get(controlCode);
      if (!control) return doc;

      let mappings = control.frameworkMappings || [];
      if (activeFrameworks) {
        const normalizedActive = new Set(
          Array.from(activeFrameworks.values()).map((value) => value.trim().toLowerCase()),
        );
        mappings = mappings.filter((mapping) =>
          normalizedActive.has(String(mapping.framework || '').trim().toLowerCase()),
        );
      }

      const codes = new Set<string>();
      for (const mapping of mappings) {
        const name = String(mapping.framework || '').trim();
        if (!name) continue;
        const code = String(mapping.frameworkCode || '').trim();
        // Ignore framework version labels (for example: v2022) and keep real control refs only.
        if (/^v\d{4}$/i.test(code)) continue;
        if (code) codes.add(code);
      }

      const references = Array.from(codes.values()).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );

      return { ...doc, frameworkReferences: references };
    });
  }

  private defaultMatchNote(status: string) {
    switch (status) {
      case 'COMPLIANT':
        return 'Evidence appears to match this control.';
      case 'PARTIAL':
        return 'Evidence partially matches this control.';
      case 'NOT_COMPLIANT':
        return 'Evidence does not satisfy this control.';
      case 'UNKNOWN':
        return 'Insufficient evidence to assess.';
      default:
        return '';
    }
  }

  private async getDocumentExcerpt(documentId: string) {
    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
      select: { text: true },
    });

    if (!chunks.length) return '';
    const joined = chunks.map((chunk) => chunk.text).join('\n');
    return joined;
  }

  private normalizeSearchText(value: string) {
    return value
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[_\-]+/g, ' ')
      .replace(/[()[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractSearchTokens(value: string) {
    const normalized = this.normalizeSearchText(value).toLowerCase();
    const stopwords = new Set([
      'policy',
      'procedure',
      'document',
      'template',
      'report',
      'assessment',
      'plan',
      'guide',
      'manual',
      'standard',
      'framework',
      'control',
      'controls',
      'version',
    ]);
    const tokens = normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopwords.has(token));
    return Array.from(new Set(tokens));
  }

  private async findControlCandidates(fileName: string, content?: string | null): Promise<ControlCandidate[]> {
    const tokens = Array.from(
      new Set([
        ...this.extractSearchTokens(fileName),
        ...(content ? this.extractSearchTokens(content.slice(0, 600)) : []),
      ]),
    );
    if (!tokens.length) return [];

    const enabledControls = await this.prisma.controlDefinition.findMany({
      where: { status: 'enabled' },
      select: {
        controlCode: true,
        title: true,
        description: true,
        isoMappings: true,
        topic: { select: { title: true } },
        frameworkMappings: { select: { framework: true, frameworkCode: true } },
      },
    });

    const codeHints = this.extractControlCodeHints(fileName);
    let candidatePool = enabledControls;
    if (codeHints.length) {
      const codeMatches = enabledControls.filter((control) =>
        codeHints.some((hint) => this.controlCodeMatchesHint(control.controlCode, hint)),
      );
      // If the file carries a control-like code and no enabled control matches it,
      // treat this as no-candidate instead of forcing semantic matching.
      if (!codeMatches.length) return [];
      candidatePool = codeMatches;
    }

    const scored = candidatePool
      .map((control) => {
        const haystack = [
          control.controlCode,
          control.title,
          control.description || '',
          control.topic?.title || '',
        ]
          .join(' ')
          .toLowerCase();
        const score = tokens.reduce((acc, token) => acc + (haystack.includes(token) ? 1 : 0), 0);
        return { control, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.control.title.localeCompare(b.control.title));

    return scored.slice(0, 8).map(({ control }) => {
      const mappingCodes = (control.frameworkMappings || [])
        .map((mapping) => String(mapping.frameworkCode || '').trim())
        .filter(Boolean);
      let isoMappings = mappingCodes.length
        ? mappingCodes
        : Array.isArray(control.isoMappings)
          ? (control.isoMappings as unknown[]).map((value) => String(value))
          : [];

      isoMappings = Array.from(
        new Set(isoMappings.map((value) => String(value || '').trim()).filter(Boolean)),
      );

      return {
        controlCode: control.controlCode,
        title: control.title,
        isoMappings,
      };
    });
  }

  async getActiveFrameworkInfo() {
    const active = await this.prisma.framework.findFirst({
      where: { status: 'enabled' },
      orderBy: { updatedAt: 'desc' },
      select: { name: true, version: true },
    });
    return {
      name: active?.name || null,
      version: active?.version || null,
    };
  }

  async getActiveFrameworkLabel() {
    const active = await this.getActiveFrameworkInfo();
    return active.name;
  }

  private async getActiveFrameworkSet() {
    // Use a single active framework (most recently updated enabled framework)
    // to avoid mixing ISO versions (e.g., 2013 vs 2022) during matching.
    const active = await this.getActiveFrameworkInfo();
    const name = String(active?.name || '').trim();
    if (!name) return null;
    return new Set([name]);
  }

  private isControlAllowed(
    control: { frameworkMappings?: Array<{ framework: string }> },
    active: Set<string>,
  ) {
    if (!active.size) return false;
    const mappings = control.frameworkMappings || [];
    if (!mappings.length) return true;
    return mappings.some((mapping) => active.has(mapping.framework));
  }
}


