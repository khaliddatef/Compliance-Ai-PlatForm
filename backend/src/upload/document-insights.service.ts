import { Injectable } from '@nestjs/common';
import * as path from 'path';

type InsightChunk = {
  chunkIndex: number;
  text: string;
};

type InsightDocument = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256?: string | null;
  createdAt?: Date | string | null;
};

type SourceRef = {
  documentId: string;
  chunkIndex: number | null;
  snippet: string;
};

type GroundedClaim = {
  value: string;
  confidence: number;
  sourceRef: SourceRef;
};

type AnalysisContext = {
  matchControlId?: string | null;
  matchStatus?: string | null;
  recommendations?: string[] | null;
};

export type DocumentAnalysisInsights = {
  version: number;
  metadata: {
    fileName: string;
    fileType: 'PDF' | 'DOCX' | 'XLSX' | 'UNKNOWN';
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string | null;
    duplicateOfDocumentId: string | null;
    wordCount: number;
    charCount: number;
    chunkCount: number;
    language: 'ar' | 'en';
    estimatedPageCount: number | null;
    generatedAt: string;
  };
  governance: {
    policyTitle: GroundedClaim | null;
    version: GroundedClaim | null;
    owner: GroundedClaim | null;
    approvedBy: GroundedClaim | null;
    approvalDate: GroundedClaim | null;
    effectiveDate: GroundedClaim | null;
    nextReviewDate: GroundedClaim | null;
  };
  controlReferences: Array<{
    controlCode: string;
    confidence: number;
    sourceRef: SourceRef;
  }>;
  obligations: Array<{
    text: string;
    modality: 'MUST' | 'SHALL' | 'REQUIRED';
    sourceRef: SourceRef;
  }>;
  evidenceArtifacts: Array<{
    type: string;
    text: string;
    sourceRef: SourceRef;
  }>;
  rolesResponsibilities: Array<{
    role: string;
    responsibility: string;
    sourceRef: SourceRef;
  }>;
  operationalSignals: {
    frequencies: GroundedClaim[];
    slaTargets: GroundedClaim[];
    dateSignals: GroundedClaim[];
  };
  exceptions: Array<{
    text: string;
    approvalPath: string | null;
    sourceRef: SourceRef;
  }>;
  riskSignals: {
    severityMentions: GroundedClaim[];
    cvssMentions: GroundedClaim[];
    incidentMentions: GroundedClaim[];
    threatMentions: GroundedClaim[];
  };
  gaps: Array<{
    code: string;
    severity: 'info' | 'warn' | 'blocker';
    message: string;
    sourceRef: SourceRef;
  }>;
  suggestedActions: Array<{
    actionType:
      | 'LINK_CONTROL'
      | 'CREATE_EVIDENCE_REQUEST'
      | 'SET_VALIDITY'
      | 'ADD_METADATA'
      | 'ASSIGN_OWNER'
      | 'REUPLOAD';
    reason: string;
    sourceRef: SourceRef;
  }>;
  grounding: {
    sourceCoverage: number;
    totalClaims: number;
    groundedClaims: number;
  };
  analysisContext: {
    matchControlId: string | null;
    matchStatus: string;
    recommendations: string[];
  };
};

type ExtractParams = {
  document: InsightDocument;
  content: string;
  chunks: InsightChunk[];
  duplicateOfDocumentId?: string | null;
  context?: AnalysisContext;
};

@Injectable()
export class DocumentInsightsService {
  extract(params: ExtractParams): DocumentAnalysisInsights {
    const normalizedChunks = this.normalizeChunks(params.chunks);
    const text = this.normalizeText(
      params.content || normalizedChunks.map((chunk) => chunk.text).join('\n'),
    );
    const words = this.countWords(text);
    const language = this.detectLanguage(text || params.document.originalName || '');
    const fileType = this.detectFileType(params.document);
    const fallbackRef = this.makeFallbackSourceRef(
      params.document.id,
      normalizedChunks,
      text,
    );

    const governance = this.extractGovernance({
      documentId: params.document.id,
      lines: this.toLines(text),
      chunks: normalizedChunks,
      fallbackRef,
      language,
    });
    const controlReferences = this.extractControlReferences({
      documentId: params.document.id,
      text,
      chunks: normalizedChunks,
      fallbackRef,
      context: params.context,
    });
    const obligations = this.extractObligations({
      documentId: params.document.id,
      sentences: this.toSentences(text),
      chunks: normalizedChunks,
      fallbackRef,
    });
    const evidenceArtifacts = this.extractEvidenceArtifacts({
      documentId: params.document.id,
      sentences: this.toSentences(text),
      chunks: normalizedChunks,
      fallbackRef,
    });
    const rolesResponsibilities = this.extractRolesResponsibilities({
      documentId: params.document.id,
      lines: this.toLines(text),
      chunks: normalizedChunks,
      fallbackRef,
    });
    const operationalSignals = this.extractOperationalSignals({
      documentId: params.document.id,
      text,
      sentences: this.toSentences(text),
      chunks: normalizedChunks,
      fallbackRef,
    });
    const exceptions = this.extractExceptions({
      documentId: params.document.id,
      sentences: this.toSentences(text),
      chunks: normalizedChunks,
      fallbackRef,
    });
    const riskSignals = this.extractRiskSignals({
      documentId: params.document.id,
      text,
      sentences: this.toSentences(text),
      chunks: normalizedChunks,
      fallbackRef,
    });
    const gaps = this.extractGaps({
      language,
      fallbackRef,
      governance,
      controlReferences,
      obligations,
      evidenceArtifacts,
      rolesResponsibilities,
      operationalSignals,
      exceptions,
    });
    const suggestedActions = this.extractSuggestedActions({
      language,
      fallbackRef,
      controlReferences,
      governance,
      obligations,
      evidenceArtifacts,
      gaps,
      context: params.context,
      hasReadableText: text.length > 0,
    });

    const totalClaims =
      this.countGovernanceClaims(governance) +
      controlReferences.length +
      obligations.length +
      evidenceArtifacts.length +
      rolesResponsibilities.length +
      operationalSignals.frequencies.length +
      operationalSignals.slaTargets.length +
      operationalSignals.dateSignals.length +
      exceptions.length +
      riskSignals.severityMentions.length +
      riskSignals.cvssMentions.length +
      riskSignals.incidentMentions.length +
      riskSignals.threatMentions.length +
      gaps.length +
      suggestedActions.length;

    const groundedClaims = totalClaims;
    const sourceCoverage = totalClaims ? 100 : 0;

    return {
      version: 1,
      metadata: {
        fileName: String(params.document.originalName || '').trim(),
        fileType,
        mimeType: String(params.document.mimeType || '').trim(),
        sizeBytes: Number(params.document.sizeBytes || 0),
        checksumSha256: String(params.document.checksumSha256 || '').trim() || null,
        duplicateOfDocumentId:
          String(params.duplicateOfDocumentId || '').trim() || null,
        wordCount: words,
        charCount: text.length,
        chunkCount: normalizedChunks.length,
        language,
        estimatedPageCount: this.estimatePages(fileType, words),
        generatedAt: new Date().toISOString(),
      },
      governance,
      controlReferences,
      obligations,
      evidenceArtifacts,
      rolesResponsibilities,
      operationalSignals,
      exceptions,
      riskSignals,
      gaps,
      suggestedActions,
      grounding: {
        sourceCoverage,
        totalClaims,
        groundedClaims,
      },
      analysisContext: {
        matchControlId: String(params.context?.matchControlId || '').trim() || null,
        matchStatus: String(params.context?.matchStatus || 'UNKNOWN').toUpperCase(),
        recommendations: Array.isArray(params.context?.recommendations)
          ? params.context!.recommendations!
              .map((value) => String(value || '').trim())
              .filter(Boolean)
              .slice(0, 6)
          : [],
      },
    };
  }

  cloneForDuplicate(params: {
    existing: unknown;
    documentId: string;
    duplicateOfDocumentId: string;
    fileName: string;
    checksumSha256: string | null;
  }): DocumentAnalysisInsights | null {
    if (!params.existing || typeof params.existing !== 'object') return null;

    const cloned = JSON.parse(JSON.stringify(params.existing)) as DocumentAnalysisInsights;
    if (!cloned || typeof cloned !== 'object' || !cloned.metadata) return null;

    cloned.metadata.fileName = params.fileName;
    cloned.metadata.checksumSha256 = params.checksumSha256;
    cloned.metadata.duplicateOfDocumentId = params.duplicateOfDocumentId;
    cloned.metadata.generatedAt = new Date().toISOString();

    if (cloned.governance?.policyTitle?.sourceRef) {
      cloned.governance.policyTitle.sourceRef.documentId = params.documentId;
    }

    this.rebindSourceRefs(cloned, params.documentId);
    return cloned;
  }

  private rebindSourceRefs(model: DocumentAnalysisInsights, documentId: string) {
    const apply = (sourceRef?: SourceRef | null) => {
      if (!sourceRef) return;
      sourceRef.documentId = documentId;
    };

    apply(model.governance.policyTitle?.sourceRef);
    apply(model.governance.version?.sourceRef);
    apply(model.governance.owner?.sourceRef);
    apply(model.governance.approvedBy?.sourceRef);
    apply(model.governance.approvalDate?.sourceRef);
    apply(model.governance.effectiveDate?.sourceRef);
    apply(model.governance.nextReviewDate?.sourceRef);
    model.controlReferences.forEach((item) => apply(item.sourceRef));
    model.obligations.forEach((item) => apply(item.sourceRef));
    model.evidenceArtifacts.forEach((item) => apply(item.sourceRef));
    model.rolesResponsibilities.forEach((item) => apply(item.sourceRef));
    model.operationalSignals.frequencies.forEach((item) => apply(item.sourceRef));
    model.operationalSignals.slaTargets.forEach((item) => apply(item.sourceRef));
    model.operationalSignals.dateSignals.forEach((item) => apply(item.sourceRef));
    model.exceptions.forEach((item) => apply(item.sourceRef));
    model.riskSignals.severityMentions.forEach((item) => apply(item.sourceRef));
    model.riskSignals.cvssMentions.forEach((item) => apply(item.sourceRef));
    model.riskSignals.incidentMentions.forEach((item) => apply(item.sourceRef));
    model.riskSignals.threatMentions.forEach((item) => apply(item.sourceRef));
    model.gaps.forEach((item) => apply(item.sourceRef));
    model.suggestedActions.forEach((item) => apply(item.sourceRef));
  }

  private normalizeChunks(chunks: InsightChunk[]) {
    if (!Array.isArray(chunks)) return [];
    return chunks
      .map((chunk) => ({
        chunkIndex: Number.isFinite(chunk?.chunkIndex)
          ? Number(chunk.chunkIndex)
          : 0,
        text: this.normalizeText(String(chunk?.text || '')),
      }))
      .filter((chunk) => chunk.text.length > 0)
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  private normalizeText(value: string) {
    return String(value || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private detectFileType(document: InsightDocument): 'PDF' | 'DOCX' | 'XLSX' | 'UNKNOWN' {
    const mime = String(document.mimeType || '').toLowerCase();
    const ext = path.extname(String(document.originalName || '')).toLowerCase();
    if (mime.includes('pdf') || ext === '.pdf') return 'PDF';
    if (
      mime.includes(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ) ||
      ext === '.docx'
    ) {
      return 'DOCX';
    }
    if (
      mime.includes(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ) ||
      ext === '.xlsx'
    ) {
      return 'XLSX';
    }
    return 'UNKNOWN';
  }

  private detectLanguage(text: string): 'ar' | 'en' {
    const arabic = (text.match(/[\u0600-\u06FF]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    return arabic > latin ? 'ar' : 'en';
  }

  private countWords(text: string) {
    const tokens = text
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
    return tokens.length;
  }

  private estimatePages(
    fileType: 'PDF' | 'DOCX' | 'XLSX' | 'UNKNOWN',
    wordCount: number,
  ) {
    if (!wordCount) return null;
    if (fileType === 'XLSX') return Math.max(1, Math.ceil(wordCount / 700));
    if (fileType === 'DOCX') return Math.max(1, Math.ceil(wordCount / 450));
    if (fileType === 'PDF') return Math.max(1, Math.ceil(wordCount / 500));
    return Math.max(1, Math.ceil(wordCount / 500));
  }

  private toLines(text: string) {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private toSentences(text: string) {
    return text
      .split(/[\n.!?؟]+/g)
      .map((line) => line.trim())
      .filter((line) => line.length >= 8);
  }

  private makeFallbackSourceRef(
    documentId: string,
    chunks: InsightChunk[],
    text: string,
  ): SourceRef {
    if (chunks.length) {
      return {
        documentId,
        chunkIndex: chunks[0].chunkIndex,
        snippet: chunks[0].text.slice(0, 220),
      };
    }
    return {
      documentId,
      chunkIndex: null,
      snippet: text.slice(0, 220),
    };
  }

  private safeSnippet(value: string) {
    return this.normalizeText(String(value || '')).slice(0, 260);
  }

  private tokenize(value: string) {
    return this.normalizeText(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s./:-]+/gu, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3)
      .slice(0, 16);
  }

  private findSourceRef(
    documentId: string,
    chunks: InsightChunk[],
    query: string,
    fallbackRef: SourceRef,
  ): SourceRef {
    const normalizedQuery = this.normalizeText(query);
    if (!normalizedQuery) return fallbackRef;
    const lowerQuery = normalizedQuery.toLowerCase();

    for (const chunk of chunks) {
      const idx = chunk.text.toLowerCase().indexOf(lowerQuery);
      if (idx >= 0) {
        const start = Math.max(0, idx - 80);
        const end = Math.min(chunk.text.length, idx + lowerQuery.length + 120);
        return {
          documentId,
          chunkIndex: chunk.chunkIndex,
          snippet: this.safeSnippet(chunk.text.slice(start, end)),
        };
      }
    }

    const tokens = this.tokenize(query);
    if (!tokens.length) return fallbackRef;

    let best: { chunk: InsightChunk; score: number } | null = null;
    for (const chunk of chunks) {
      const hay = chunk.text.toLowerCase();
      const score = tokens.reduce(
        (acc, token) => acc + (hay.includes(token) ? 1 : 0),
        0,
      );
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { chunk, score };
      }
    }

    if (!best) return fallbackRef;
    return {
      documentId,
      chunkIndex: best.chunk.chunkIndex,
      snippet: this.safeSnippet(best.chunk.text),
    };
  }

  private makeClaim(
    params: {
      value: string;
      confidence: number;
      documentId: string;
      chunks: InsightChunk[];
      fallbackRef: SourceRef;
      query?: string;
    },
  ): GroundedClaim {
    return {
      value: params.value,
      confidence: Math.max(0, Math.min(100, Math.round(params.confidence))),
      sourceRef: this.findSourceRef(
        params.documentId,
        params.chunks,
        params.query || params.value,
        params.fallbackRef,
      ),
    };
  }

  private findLabeledValue(lines: string[], labels: RegExp[]) {
    for (const line of lines) {
      for (const label of labels) {
        const match = label.exec(line);
        if (match?.[1]) return match[1].trim();
      }
    }
    return null;
  }

  private findFirstDate(value: string) {
    const dateRegex =
      /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i;
    const match = dateRegex.exec(value);
    return match?.[1] ? match[1].trim() : null;
  }

  private extractGovernance(params: {
    documentId: string;
    lines: string[];
    chunks: InsightChunk[];
    fallbackRef: SourceRef;
    language: 'ar' | 'en';
  }) {
    const { lines, documentId, chunks, fallbackRef, language } = params;
    const titleLine =
      lines.find((line) =>
        /(policy|procedure|standard|guideline|سياسة|إجراء|معيار|دليل)/i.test(line),
      ) || lines[0] || '';

    const version = this.findLabeledValue(lines, [
      /(?:^|\b)(?:version|revision|rev|issue)\s*[:#-]?\s*([a-z0-9_.-]+)/i,
      /(?:^|\b)(?:الإصدار|نسخة)\s*[:#-]?\s*([a-z0-9_.-]+)/i,
    ]);
    const owner = this.findLabeledValue(lines, [
      /(?:document owner|policy owner|owner|responsible(?:\s+role)?)\s*[:#-]?\s*(.+)$/i,
      /(?:مالك الوثيقة|مالك السياسة|المالك|المسؤول)\s*[:#-]?\s*(.+)$/i,
    ]);
    const approvedBy = this.findLabeledValue(lines, [
      /(?:approved by|approver|approved authority)\s*[:#-]?\s*(.+)$/i,
      /(?:اعتمد بواسطة|معتمد من|الاعتماد)\s*[:#-]?\s*(.+)$/i,
    ]);

    const approvalLine =
      lines.find((line) =>
        /(approval date|approved on|date approved|تاريخ الاعتماد|تاريخ الموافقة)/i.test(
          line,
        ),
      ) || '';
    const effectiveLine =
      lines.find((line) =>
        /(effective date|effective on|valid from|تاريخ السريان|يسري من)/i.test(line),
      ) || '';
    const nextReviewLine =
      lines.find((line) =>
        /(next review|review date|reviewed by date|المراجعة القادمة|تاريخ المراجعة)/i.test(
          line,
        ),
      ) || '';

    const approvalDate = this.findFirstDate(approvalLine);
    const effectiveDate = this.findFirstDate(effectiveLine);
    const nextReviewDate = this.findFirstDate(nextReviewLine);

    const fallbackTitle =
      language === 'ar' ? 'وثيقة سياسة/إجراء' : 'Policy/Procedure document';
    const policyTitle = this.makeClaim({
      value: titleLine || fallbackTitle,
      confidence: titleLine ? 88 : 45,
      documentId,
      chunks,
      fallbackRef,
      query: titleLine || fallbackTitle,
    });

    return {
      policyTitle,
      version: version
        ? this.makeClaim({
            value: version,
            confidence: 86,
            documentId,
            chunks,
            fallbackRef,
            query: `version ${version}`,
          })
        : null,
      owner: owner
        ? this.makeClaim({
            value: owner,
            confidence: 80,
            documentId,
            chunks,
            fallbackRef,
            query: owner,
          })
        : null,
      approvedBy: approvedBy
        ? this.makeClaim({
            value: approvedBy,
            confidence: 80,
            documentId,
            chunks,
            fallbackRef,
            query: approvedBy,
          })
        : null,
      approvalDate: approvalDate
        ? this.makeClaim({
            value: approvalDate,
            confidence: 84,
            documentId,
            chunks,
            fallbackRef,
            query: approvalLine || approvalDate,
          })
        : null,
      effectiveDate: effectiveDate
        ? this.makeClaim({
            value: effectiveDate,
            confidence: 84,
            documentId,
            chunks,
            fallbackRef,
            query: effectiveLine || effectiveDate,
          })
        : null,
      nextReviewDate: nextReviewDate
        ? this.makeClaim({
            value: nextReviewDate,
            confidence: 82,
            documentId,
            chunks,
            fallbackRef,
            query: nextReviewLine || nextReviewDate,
          })
        : null,
    };
  }

  private extractControlReferences(params: {
    documentId: string;
    text: string;
    chunks: InsightChunk[];
    fallbackRef: SourceRef;
    context?: AnalysisContext;
  }) {
    const entries = new Map<string, { confidence: number; query: string }>();
    const explicitRegexes = [
      /\bA\.\d{1,2}\.\d{1,2}(?:\.\d{1,2})?\b/gi,
      /\b\d{1,2}\.\d{1,2}(?:\.\d{1,2})?\b/g,
      /\b[A-Z]{2,6}-\d{1,3}(?:\([A-Za-z0-9]+\))?\b/g,
    ];

    for (const regex of explicitRegexes) {
      const matches = params.text.match(regex) || [];
      for (const match of matches) {
        const normalized = match.trim();
        if (!normalized) continue;
        if (normalized.length <= 2) continue;
        if (!entries.has(normalized)) {
          entries.set(normalized, { confidence: 82, query: normalized });
        }
      }
    }

    const matchedControl = String(params.context?.matchControlId || '').trim();
    if (matchedControl) {
      entries.set(matchedControl, {
        confidence: 78,
        query: matchedControl,
      });
    }

    return Array.from(entries.entries())
      .slice(0, 20)
      .map(([controlCode, meta]) => ({
        controlCode,
        confidence: meta.confidence,
        sourceRef: this.findSourceRef(
          params.documentId,
          params.chunks,
          meta.query,
          params.fallbackRef,
        ),
      }));
  }

  private extractObligations(params: {
    documentId: string;
    sentences: string[];
    chunks: InsightChunk[];
    fallbackRef: SourceRef;
  }) {
    const seen = new Set<string>();
    const obligations: Array<{
      text: string;
      modality: 'MUST' | 'SHALL' | 'REQUIRED';
      sourceRef: SourceRef;
    }> = [];

    for (const sentence of params.sentences) {
      const normalized = sentence.trim();
      if (!normalized || seen.has(normalized.toLowerCase())) continue;

      const lower = normalized.toLowerCase();
      let modality: 'MUST' | 'SHALL' | 'REQUIRED' | null = null;
      if (/\bmust\b/.test(lower) || /(?:يجب|يلزم|لابد)/.test(normalized)) modality = 'MUST';
      else if (/\bshall\b/.test(lower)) modality = 'SHALL';
      else if (/\brequired\b/.test(lower) || /(?:مطلوب|الزامي|إلزامي)/.test(normalized)) {
        modality = 'REQUIRED';
      }
      if (!modality) continue;

      seen.add(normalized.toLowerCase());
      obligations.push({
        text: normalized,
        modality,
        sourceRef: this.findSourceRef(
          params.documentId,
          params.chunks,
          normalized,
          params.fallbackRef,
        ),
      });
      if (obligations.length >= 20) break;
    }

    return obligations;
  }

  private extractEvidenceArtifacts(params: {
    documentId: string;
    sentences: string[];
    chunks: InsightChunk[];
    fallbackRef: SourceRef;
  }) {
    const patterns: Array<{ type: string; regex: RegExp }> = [
      { type: 'LOGS', regex: /\b(logs?|audit logs?|سجل(?:ات)?|سجلات تدقيق)\b/i },
      { type: 'SCREENSHOT', regex: /\b(screenshot|screen shot|لقطة شاشة|لقطات شاشة)\b/i },
      { type: 'TICKET', regex: /\b(ticket|jira|service ?now|change request|تذكرة|جيرا)\b/i },
      { type: 'REPORT', regex: /\b(report|assessment report|تقرير|تقارير)\b/i },
      { type: 'CONFIG_EXPORT', regex: /\b(config(?:uration)? export|baseline|إعدادات|تهيئة)\b/i },
      { type: 'SIEM', regex: /\b(siem|splunk|qradar|sentinel)\b/i },
      { type: 'EVIDENCE_RECORD', regex: /\b(evidence|proof|artifact|دليل|أدلة)\b/i },
    ];

    const out: Array<{ type: string; text: string; sourceRef: SourceRef }> = [];
    const dedup = new Set<string>();

    for (const sentence of params.sentences) {
      for (const pattern of patterns) {
        if (!pattern.regex.test(sentence)) continue;
        const key = `${pattern.type}|${sentence}`.toLowerCase();
        if (dedup.has(key)) continue;
        dedup.add(key);
        out.push({
          type: pattern.type,
          text: sentence,
          sourceRef: this.findSourceRef(
            params.documentId,
            params.chunks,
            sentence,
            params.fallbackRef,
          ),
        });
      }
      if (out.length >= 24) break;
    }

    return out;
  }

  private extractRolesResponsibilities(params: {
    documentId: string;
    lines: string[];
    chunks: InsightChunk[];
    fallbackRef: SourceRef;
  }) {
    const out: Array<{ role: string; responsibility: string; sourceRef: SourceRef }> = [];
    const roleRegex =
      /(dpo|ciso|cio|iso|security team|it manager|owner|approver|reviewer|administrator|admin|مسؤول حماية البيانات|مسؤول الأمن|مدير تقنية المعلومات|المالك|المراجع|المعتمد)/i;
    const dutyRegex =
      /(responsible|accountable|must|shall|review|approve|maintain|monitor|implement|owns|يتولى|مسؤول|يراجع|يعتمد|ينفذ|يتابع|يحافظ)/i;

    for (const line of params.lines) {
      if (!roleRegex.test(line)) continue;
      if (!dutyRegex.test(line)) continue;

      const roleMatch = line.match(roleRegex);
      const role = String(roleMatch?.[0] || 'Role').trim();
      out.push({
        role,
        responsibility: line,
        sourceRef: this.findSourceRef(
          params.documentId,
          params.chunks,
          line,
          params.fallbackRef,
        ),
      });
      if (out.length >= 20) break;
    }

    return out;
  }

  private extractOperationalSignals(params: {
    documentId: string;
    text: string;
    sentences: string[];
    chunks: InsightChunk[];
    fallbackRef: SourceRef;
  }) {
    const frequencies: GroundedClaim[] = [];
    const slaTargets: GroundedClaim[] = [];
    const dateSignals: GroundedClaim[] = [];

    const frequencyRegex =
      /\b(daily|weekly|monthly|quarterly|annually|yearly|every\s+\d+\s+(?:day|days|week|weeks|month|months)|يومي|أسبوعي|شهري|ربع سنوي|سنوي|كل\s+\d+\s*(?:يوم|أسبوع|شهر))\b/i;
    const slaRegex =
      /\b(sla|within\s+\d+\s+(?:hour|hours|day|days)|response time|resolution time|خلال\s+\d+\s*(?:ساعة|ساعات|يوم|أيام))\b/i;
    const dateRegex =
      /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i;

    for (const sentence of params.sentences) {
      if (frequencyRegex.test(sentence)) {
        frequencies.push(
          this.makeClaim({
            value: sentence,
            confidence: 79,
            documentId: params.documentId,
            chunks: params.chunks,
            fallbackRef: params.fallbackRef,
            query: sentence,
          }),
        );
      }
      if (slaRegex.test(sentence)) {
        slaTargets.push(
          this.makeClaim({
            value: sentence,
            confidence: 77,
            documentId: params.documentId,
            chunks: params.chunks,
            fallbackRef: params.fallbackRef,
            query: sentence,
          }),
        );
      }
      if (dateRegex.test(sentence)) {
        dateSignals.push(
          this.makeClaim({
            value: sentence,
            confidence: 75,
            documentId: params.documentId,
            chunks: params.chunks,
            fallbackRef: params.fallbackRef,
            query: sentence,
          }),
        );
      }
      if (
        frequencies.length >= 12 &&
        slaTargets.length >= 12 &&
        dateSignals.length >= 12
      ) {
        break;
      }
    }

    return {
      frequencies: this.uniqueClaims(frequencies, 12),
      slaTargets: this.uniqueClaims(slaTargets, 12),
      dateSignals: this.uniqueClaims(dateSignals, 12),
    };
  }

  private extractExceptions(params: {
    documentId: string;
    sentences: string[];
    chunks: InsightChunk[];
    fallbackRef: SourceRef;
  }) {
    const out: Array<{ text: string; approvalPath: string | null; sourceRef: SourceRef }> = [];
    const exceptionRegex =
      /\b(exception|exceptions|waiver|waivers|exemption|exemptions|deviation|temporary exception|استثناء|استثناءات|إعفاء|انحراف)\b/i;
    const approvalRegex =
      /\b(approved by|approval|approver|management approval|requires approval|يعتمد|موافقة|موافق(?:ة)? الإدارة|اعتماد)\b/i;

    for (const sentence of params.sentences) {
      if (!exceptionRegex.test(sentence)) continue;
      out.push({
        text: sentence,
        approvalPath: approvalRegex.test(sentence) ? sentence : null,
        sourceRef: this.findSourceRef(
          params.documentId,
          params.chunks,
          sentence,
          params.fallbackRef,
        ),
      });
      if (out.length >= 12) break;
    }

    return out;
  }

  private extractRiskSignals(params: {
    documentId: string;
    text: string;
    sentences: string[];
    chunks: InsightChunk[];
    fallbackRef: SourceRef;
  }) {
    const collect = (regex: RegExp, confidence: number) => {
      const claims: GroundedClaim[] = [];
      for (const sentence of params.sentences) {
        if (!regex.test(sentence)) continue;
        claims.push(
          this.makeClaim({
            value: sentence,
            confidence,
            documentId: params.documentId,
            chunks: params.chunks,
            fallbackRef: params.fallbackRef,
            query: sentence,
          }),
        );
        if (claims.length >= 16) break;
      }
      return this.uniqueClaims(claims, 16);
    };

    return {
      severityMentions: collect(
        /\b(critical|high|medium|low|severity|شديد|مرتفع|متوسط|منخفض|الخطورة)\b/i,
        74,
      ),
      cvssMentions: collect(/\b(cvss|base score)\b/i, 85),
      incidentMentions: collect(
        /\b(incident|breach|attack|event|incident response|حادث|اختراق|هجوم)\b/i,
        76,
      ),
      threatMentions: collect(
        /\b(vulnerability|threat|malware|ransomware|exploit|ثغرة|تهديد|برمجيات خبيثة)\b/i,
        76,
      ),
    };
  }

  private extractGaps(params: {
    language: 'ar' | 'en';
    fallbackRef: SourceRef;
    governance: DocumentAnalysisInsights['governance'];
    controlReferences: DocumentAnalysisInsights['controlReferences'];
    obligations: DocumentAnalysisInsights['obligations'];
    evidenceArtifacts: DocumentAnalysisInsights['evidenceArtifacts'];
    rolesResponsibilities: DocumentAnalysisInsights['rolesResponsibilities'];
    operationalSignals: DocumentAnalysisInsights['operationalSignals'];
    exceptions: DocumentAnalysisInsights['exceptions'];
  }) {
    const gaps: Array<{
      code: string;
      severity: 'info' | 'warn' | 'blocker';
      message: string;
      sourceRef: SourceRef;
    }> = [];

    if (!params.controlReferences.length) {
      gaps.push({
        code: 'MISSING_CONTROL_REFERENCE',
        severity: 'blocker',
        message:
          params.language === 'ar'
            ? 'لا يوجد مرجع كنترول واضح داخل الملف.'
            : 'No explicit control reference was detected in the file.',
        sourceRef: params.fallbackRef,
      });
    }

    if (!params.governance.owner) {
      gaps.push({
        code: 'MISSING_OWNER',
        severity: 'warn',
        message:
          params.language === 'ar'
            ? 'لم يتم العثور على مالك واضح للسياسة/الإجراء.'
            : 'Policy/procedure owner is not clearly defined.',
        sourceRef: params.fallbackRef,
      });
    }

    if (!params.governance.approvedBy) {
      gaps.push({
        code: 'MISSING_APPROVAL',
        severity: 'warn',
        message:
          params.language === 'ar'
            ? 'لا يوجد اعتماد رسمي واضح داخل الملف.'
            : 'No explicit approver/approval line was found.',
        sourceRef: params.fallbackRef,
      });
    }

    if (!params.governance.nextReviewDate && !params.operationalSignals.frequencies.length) {
      gaps.push({
        code: 'MISSING_REVIEW_CYCLE',
        severity: 'warn',
        message:
          params.language === 'ar'
            ? 'دورة المراجعة الدورية غير واضحة.'
            : 'Periodic review cycle is not clearly documented.',
        sourceRef: params.fallbackRef,
      });
    }

    if (!params.obligations.length) {
      gaps.push({
        code: 'MISSING_OBLIGATIONS',
        severity: 'warn',
        message:
          params.language === 'ar'
            ? 'لا توجد التزامات تنفيذية واضحة بصياغة إلزامية.'
            : 'No enforceable obligations were detected (must/shall/required).',
        sourceRef: params.fallbackRef,
      });
    }

    if (!params.evidenceArtifacts.length) {
      gaps.push({
        code: 'MISSING_EVIDENCE_ARTIFACTS',
        severity: 'warn',
        message:
          params.language === 'ar'
            ? 'الملف لا يحدد أنواع أدلة تشغيلية داعمة بشكل كافٍ.'
            : 'Operational evidence artifacts (logs/tickets/reports) are not clearly defined.',
        sourceRef: params.fallbackRef,
      });
    }

    if (!params.rolesResponsibilities.length) {
      gaps.push({
        code: 'MISSING_ROLE_ACCOUNTABILITY',
        severity: 'warn',
        message:
          params.language === 'ar'
            ? 'الأدوار والمسؤوليات غير موثقة بشكل واضح.'
            : 'Roles and accountability are not explicitly documented.',
        sourceRef: params.fallbackRef,
      });
    }

    if (!params.exceptions.length) {
      gaps.push({
        code: 'MISSING_EXCEPTION_FLOW',
        severity: 'info',
        message:
          params.language === 'ar'
            ? 'لا يوجد مسار استثناءات واضح (متى ومن يعتمد).'
            : 'No explicit exception/waiver workflow was found.',
        sourceRef: params.fallbackRef,
      });
    }

    return gaps.slice(0, 12);
  }

  private extractSuggestedActions(params: {
    language: 'ar' | 'en';
    fallbackRef: SourceRef;
    controlReferences: DocumentAnalysisInsights['controlReferences'];
    governance: DocumentAnalysisInsights['governance'];
    obligations: DocumentAnalysisInsights['obligations'];
    evidenceArtifacts: DocumentAnalysisInsights['evidenceArtifacts'];
    gaps: DocumentAnalysisInsights['gaps'];
    context?: AnalysisContext;
    hasReadableText: boolean;
  }) {
    const actions: Array<{
      actionType:
        | 'LINK_CONTROL'
        | 'CREATE_EVIDENCE_REQUEST'
        | 'SET_VALIDITY'
        | 'ADD_METADATA'
        | 'ASSIGN_OWNER'
        | 'REUPLOAD';
      reason: string;
      sourceRef: SourceRef;
    }> = [];

    if (!params.hasReadableText) {
      actions.push({
        actionType: 'REUPLOAD',
        reason:
          params.language === 'ar'
            ? 'لم يتم استخراج نص مقروء من الملف الحالي.'
            : 'No readable text was extracted from this file.',
        sourceRef: params.fallbackRef,
      });
      return actions;
    }

    if (!params.controlReferences.length) {
      actions.push({
        actionType: 'LINK_CONTROL',
        reason:
          params.language === 'ar'
            ? 'حدد كنترول واحد أو أكثر لربط الدليل.'
            : 'Link this file to one or more controls.',
        sourceRef: params.fallbackRef,
      });
    }

    if (!params.evidenceArtifacts.length || !params.obligations.length) {
      actions.push({
        actionType: 'CREATE_EVIDENCE_REQUEST',
        reason:
          params.language === 'ar'
            ? 'أنشئ طلب دليل تكميلي لإغلاق فجوات التنفيذ.'
            : 'Create an evidence request to close implementation gaps.',
        sourceRef: params.fallbackRef,
      });
    }

    if (!params.governance.nextReviewDate && !params.governance.effectiveDate) {
      actions.push({
        actionType: 'SET_VALIDITY',
        reason:
          params.language === 'ar'
            ? 'أضف تاريخ سريان/مراجعة للملف.'
            : 'Set validity dates (effective/review dates).',
        sourceRef: params.fallbackRef,
      });
    }

    if (!params.governance.version || !params.governance.approvedBy) {
      actions.push({
        actionType: 'ADD_METADATA',
        reason:
          params.language === 'ar'
            ? 'أضف بيانات الحوكمة المفقودة (الإصدار/الاعتماد).'
            : 'Add missing governance metadata (version/approval).',
        sourceRef: params.fallbackRef,
      });
    }

    if (!params.governance.owner) {
      actions.push({
        actionType: 'ASSIGN_OWNER',
        reason:
          params.language === 'ar'
            ? 'حدد مالك واضح للسياسة/الإجراء.'
            : 'Assign a clear owner for this policy/procedure.',
        sourceRef: params.fallbackRef,
      });
    }

    const missingControlGap = params.gaps.some(
      (gap) => gap.code === 'MISSING_CONTROL_REFERENCE',
    );
    const recommendations = Array.isArray(params.context?.recommendations)
      ? params.context!.recommendations!
      : [];
    if (
      missingControlGap &&
      recommendations.some((item) => /link|control|ربط|كنترول/i.test(String(item || '')))
    ) {
      actions.unshift({
        actionType: 'LINK_CONTROL',
        reason:
          params.language === 'ar'
            ? 'تحليل الملف يقترح الربط بكنترول من الكتالوج.'
            : 'Analysis indicates this file should be linked to a catalog control.',
        sourceRef: params.fallbackRef,
      });
    }

    const dedup = new Set<string>();
    return actions.filter((action) => {
      if (dedup.has(action.actionType)) return false;
      dedup.add(action.actionType);
      return true;
    });
  }

  private uniqueClaims(claims: GroundedClaim[], limit: number) {
    const seen = new Set<string>();
    const out: GroundedClaim[] = [];
    for (const claim of claims) {
      const key = claim.value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(claim);
      if (out.length >= limit) break;
    }
    return out;
  }

  private countGovernanceClaims(governance: DocumentAnalysisInsights['governance']) {
    let count = 0;
    if (governance.policyTitle) count += 1;
    if (governance.version) count += 1;
    if (governance.owner) count += 1;
    if (governance.approvedBy) count += 1;
    if (governance.approvalDate) count += 1;
    if (governance.effectiveDate) count += 1;
    if (governance.nextReviewDate) count += 1;
    return count;
  }
}
