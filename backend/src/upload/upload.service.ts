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
    standard: string;
    kind: DocKind;
    files: Express.Multer.File[];
    user: { id: string; role: string };
    language?: 'ar' | 'en';
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
    const { conversationId, standard, kind, files, user, language } = params;
    const standardKey = String(standard || 'ISO').toUpperCase();
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
            standard: standardKey,
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
      } catch (e: any) {
        console.error(`[OPENAI] ${label} upload/attach failed for`, doc.originalName, e?.message || e);
      }
    };

    if (kind === 'CUSTOMER' && customerVectorStoreId) {
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
          const excerpt = await this.getDocumentExcerpt(doc.id);
          const candidates = await this.findControlCandidates(
            standardKey,
            doc.originalName || '',
            excerpt,
          );
          const analysis = await this.agent.analyzeCustomerDocument({
            standard: standardKey as any,
            fileName: doc.originalName,
            content: excerpt,
            customerVectorStoreId,
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

    return {
      ok: true,
      conversationId,
      standard: standardKey,
      kind,
      count: documents.length,
      documents: documentsWithReferences,
      ingestResults,
      customerVectorStoreId,
    };
  }

  async listByConversation(params: {
    conversationId: string;
    standard?: string;
    kind?: DocKind;
    user?: { id: string; role: string };
  }) {
    const { conversationId, standard, kind, user } = params;

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
        ...(standard ? { standard } : {}),
        ...(kind ? { kind } : {}),
      },
      include: {
        _count: { select: { chunks: true } },
        conversation: { select: { title: true, user: { select: { name: true, email: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const withHints = await this.attachEvaluationHints(docs);
    return this.attachFrameworkReferences(withHints);
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
    return this.attachFrameworkReferences(withHints);
  }

  getDocumentById(id: string) {
    return this.prisma.document.findUnique({ where: { id } });
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

    const excerpt = await this.getDocumentExcerpt(doc.id);
    const candidates = await this.findControlCandidates(
      String(doc.standard || 'ISO').toUpperCase(),
      doc.originalName || '',
      excerpt,
    );

    const analysis = await this.agent.analyzeCustomerDocument({
      standard: (doc.standard as any) || 'ISO',
      fileName: doc.originalName,
      content: excerpt,
      customerVectorStoreId: doc.conversation?.customerVectorStoreId || undefined,
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
    return withRefs[0] || updated;
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

  async cleanupOpenAiResources(params: {
    documents: Array<{
      openaiFileId?: string | null;
      kind: string;
      standard: string;
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

    const docsWithControl = docs.filter((doc) => doc?.matchControlId && doc?.standard);
    if (!docsWithControl.length) return docs;

    const standards = Array.from(
      new Set(docsWithControl.map((doc) => String(doc.standard || '').toUpperCase()).filter(Boolean)),
    );

    const activeByStandard = new Map<string, Set<string> | null>();
    for (const standard of standards) {
      activeByStandard.set(standard, await this.getActiveFrameworkSet(standard));
    }

    const controlCodes = Array.from(
      new Set(docsWithControl.map((doc) => String(doc.matchControlId)).filter(Boolean)),
    );
    if (!controlCodes.length) return docs;

    const controls = await this.prisma.controlDefinition.findMany({
      where: {
        controlCode: { in: controlCodes },
        topic: { standard: { in: standards } },
      },
      select: {
        controlCode: true,
        topic: { select: { standard: true } },
        frameworkMappings: { select: { framework: true, frameworkCode: true } },
      },
    });

    const controlMap = new Map<string, { frameworkMappings: Array<{ framework: string; frameworkCode: string }> }>();
    for (const control of controls) {
      const standard = String(control.topic?.standard || '').toUpperCase();
      if (!standard) continue;
      controlMap.set(`${standard}::${control.controlCode}`, {
        frameworkMappings: control.frameworkMappings || [],
      });
    }

    return docs.map((doc) => {
      const standard = String(doc.standard || '').toUpperCase();
      const controlCode = String(doc.matchControlId || '');
      if (!standard || !controlCode) return doc;

      const control = controlMap.get(`${standard}::${controlCode}`);
      if (!control) return doc;

      const active = activeByStandard.get(standard);
      let mappings = control.frameworkMappings || [];
      if (active) {
        mappings = mappings.filter((mapping) => active.has(mapping.framework));
      }

      if (!mappings.length) {
        return { ...doc, frameworkReferences: [] };
      }

      const grouped = new Map<string, Set<string>>();
      for (const mapping of mappings) {
        const name = String(mapping.framework || '').trim();
        if (!name) continue;
        const code = String(mapping.frameworkCode || '').trim();
        const set = grouped.get(name) || new Set<string>();
        if (code) set.add(code);
        grouped.set(name, set);
      }

      const references = Array.from(grouped.entries()).map(([name, codes]) => {
        const codeList = Array.from(codes.values()).filter(Boolean);
        return codeList.length ? `${name} ${codeList.join(', ')}` : name;
      });

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
      take: 6,
      select: { text: true },
    });

    if (!chunks.length) return '';
    const joined = chunks.map((chunk) => chunk.text).join('\n');
    return joined.slice(0, 6000);
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

  private async findControlCandidates(
    standard: string,
    fileName: string,
    content?: string | null,
  ): Promise<ControlCandidate[]> {
    let tokens = this.extractSearchTokens(fileName);
    if (!tokens.length && content) {
      tokens = this.extractSearchTokens(content.slice(0, 180));
    }
    if (!tokens.length) return [];

    const orFilters = tokens.flatMap((token) => [
      { title: { contains: token } },
      { description: { contains: token } },
      { controlCode: { contains: token } },
      { topic: { title: { contains: token } } },
    ]);

    const results = await this.prisma.controlDefinition.findMany({
      where: { topic: { standard }, OR: orFilters },
      select: {
        controlCode: true,
        title: true,
        description: true,
        isoMappings: true,
        topic: { select: { title: true } },
        frameworkMappings: { select: { framework: true } },
      },
      take: 50,
    });

    const activeFrameworks = await this.getActiveFrameworkSet(standard);
    const filtered = activeFrameworks
      ? results.filter((control) => this.isControlAllowed(control, activeFrameworks))
      : results;

    const scored = filtered
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

    return scored.slice(0, 8).map(({ control }) => ({
      controlCode: control.controlCode,
      title: control.title,
      isoMappings: Array.isArray(control.isoMappings)
        ? (control.isoMappings as unknown[]).map((value) => String(value))
        : [],
    }));
  }

  private async getActiveFrameworkSet(standard: string) {
    const frameworks = await this.prisma.framework.findMany({
      where: { standard },
      select: { name: true, status: true },
    });
    if (!frameworks.length) return null;
    const enabled = frameworks.filter((item) => item.status === 'enabled').map((item) => item.name);
    return new Set(enabled);
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
