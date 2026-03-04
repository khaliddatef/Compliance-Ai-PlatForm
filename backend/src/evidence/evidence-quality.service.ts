import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';

export type EvidenceQualityGrade = 'STRONG' | 'MEDIUM' | 'WEAK';

export type EvidenceQualityReason = {
  code: string;
  msg: string;
  severity: 'info' | 'warn' | 'blocker';
};

export type EvidenceQualityFix = {
  code: string;
  msg: string;
  suggestedAction: 'CREATE_REQUEST' | 'LINK_CONTROL' | 'ADD_METADATA' | 'REUPLOAD';
};

export type EvidenceQualityFactors = {
  version: number;
  relevance: {
    points: number;
    max: number;
    signals: string[];
  };
  reliability: {
    points: number;
    max: number;
    signals: string[];
  };
  freshness: {
    points: number;
    max: number;
    signals: string[];
  };
  completeness: {
    points: number;
    max: number;
    signals: string[];
  };
  reasons: EvidenceQualityReason[];
  fixes: EvidenceQualityFix[];
  coverage: {
    linkedControls: string[];
    linkedRequests: string[];
    linkedTestComponents: string[];
  };
};

export type EvidenceQualityPayload = {
  score: number;
  grade: EvidenceQualityGrade;
  factors: EvidenceQualityFactors;
  computedAt: string;
  version: number;
};

type EvidenceRow = {
  id: string;
  title: string;
  type: string;
  source: string;
  documentId: string | null;
  url: string | null;
  status: string;
  createdAt: string;
  validFrom: string | null;
  validTo: string | null;
  reviewedById: string | null;
  reviewComment: string | null;
  qualityScore: number | null;
  qualityGrade: string | null;
  qualityFactors: unknown;
  qualityComputedAt: string | null;
  qualityVersion: number | null;
};

type QualityContext = {
  controlId?: string | null;
  testComponentId?: string | null;
};

type BuildQualityInput = {
  evidence: {
    id: string;
    title: string;
    type: string;
    source: string;
    documentId: string | null;
    url: string | null;
    status: string;
    createdAt: string;
    validFrom: string | null;
    validTo: string | null;
    reviewedById: string | null;
    reviewComment: string | null;
  };
  coverage: {
    linkedControls: string[];
    linkedRequests: string[];
    linkedTestComponents: string[];
  };
  frequencyDays: number;
  context?: QualityContext;
  now?: Date;
};

const QUALITY_VERSION = 1;
const RECALC_COOLDOWN_MS = 10_000;

const MAX_RELEVANCE = 30;
const MAX_RELIABILITY = 30;
const MAX_FRESHNESS = 20;
const MAX_COMPLETENESS = 20;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalizeEvidenceType = (value: string) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s\-]+/g, '_');

const toDateOrNull = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const ageInDays = (start: Date, end: Date) => {
  const diff = end.getTime() - start.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / 86400000);
};

const uniq = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));

const reliabilityPointsForType = (value: string) => {
  const type = normalizeEvidenceType(value);
  if (
    type === 'LOGS' ||
    type === 'LOG' ||
    type === 'SYSTEM_REPORT' ||
    type === 'CONFIG_EXPORT' ||
    type === 'SYSTEM_LOG'
  ) {
    return { points: 30, canonical: 'LOGS' };
  }
  if (type === 'TICKET_WITH_APPROVAL' || type === 'CHANGE_TICKET' || type === 'APPROVAL_TICKET') {
    return { points: 24, canonical: 'TICKET_WITH_APPROVAL' };
  }
  if (type === 'SCREENSHOT') {
    return { points: 18, canonical: 'SCREENSHOT' };
  }
  if (type === 'PROCEDURE' || type === 'SOP') {
    return { points: 14, canonical: 'PROCEDURE' };
  }
  if (type === 'POLICY') {
    return { points: 10, canonical: 'POLICY' };
  }
  if (type === 'ATTESTATION') {
    return { points: 8, canonical: 'ATTESTATION' };
  }
  return { points: 16, canonical: 'OTHER' };
};

const cadenceFromFrequency = (frequencyDays: number): 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' => {
  if (frequencyDays <= 45) return 'MONTHLY';
  if (frequencyDays <= 180) return 'QUARTERLY';
  return 'ANNUAL';
};

const freshnessByCadence = (cadence: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL', days: number) => {
  if (cadence === 'MONTHLY') {
    if (days <= 30) return { points: 20, band: 'FRESH' };
    if (days <= 60) return { points: 10, band: 'BORDERLINE' };
    return { points: 4, band: 'STALE' };
  }
  if (cadence === 'ANNUAL') {
    if (days <= 365) return { points: 20, band: 'FRESH' };
    if (days <= 450) return { points: 10, band: 'BORDERLINE' };
    return { points: 4, band: 'STALE' };
  }
  if (days <= 90) return { points: 20, band: 'FRESH' };
  if (days <= 120) return { points: 10, band: 'BORDERLINE' };
  return { points: 4, band: 'STALE' };
};

const pushReason = (reasons: EvidenceQualityReason[], reason: EvidenceQualityReason) => {
  if (reasons.some((item) => item.code === reason.code)) return;
  reasons.push(reason);
};

const pushFix = (fixes: EvidenceQualityFix[], fix: EvidenceQualityFix) => {
  if (fixes.some((item) => item.code === fix.code)) return;
  fixes.push(fix);
};

const metadataMissingFields = (input: BuildQualityInput['evidence']) => {
  const missing: string[] = [];
  if (!String(input.title || '').trim()) missing.push('title');
  if (!String(input.type || '').trim()) missing.push('type');
  if (!String(input.source || '').trim()) missing.push('source');

  const source = String(input.source || '').trim().toLowerCase();
  if (source === 'upload' && !String(input.documentId || '').trim()) {
    missing.push('documentId');
  }
  if (source === 'link' && !String(input.url || '').trim()) {
    missing.push('url');
  }

  const type = normalizeEvidenceType(input.type);
  if ((type === 'POLICY' || type === 'PROCEDURE') && !toDateOrNull(input.validTo)) {
    missing.push('validTo');
  }

  return missing;
};

const gradeFromScore = (score: number): EvidenceQualityGrade => {
  if (score >= 80) return 'STRONG';
  if (score >= 50) return 'MEDIUM';
  return 'WEAK';
};

export const buildEvidenceQuality = (input: BuildQualityInput): {
  score: number;
  grade: EvidenceQualityGrade;
  factors: EvidenceQualityFactors;
} => {
  const now = input.now || new Date();
  const reasons: EvidenceQualityReason[] = [];
  const fixes: EvidenceQualityFix[] = [];

  const linkedControls = uniq(input.coverage.linkedControls);
  const linkedRequests = uniq(input.coverage.linkedRequests);
  const linkedTestComponents = uniq(input.coverage.linkedTestComponents);

  let relevance = 0;
  const relevanceSignals: string[] = [];
  if (linkedControls.length > 0) {
    relevance += 15;
    relevanceSignals.push('LINKED_TO_CONTROL');
  } else {
    pushReason(reasons, {
      code: 'EVIDENCE_NOT_LINKED',
      msg: 'Evidence is not linked to any control.',
      severity: 'blocker',
    });
    pushFix(fixes, {
      code: 'LINK_TO_CONTROL',
      msg: 'Link this evidence to at least one control.',
      suggestedAction: 'LINK_CONTROL',
    });
  }

  const inControlContext =
    !!String(input.context?.controlId || '').trim() &&
    linkedControls.includes(String(input.context?.controlId || '').trim());
  const inTestContext =
    !!String(input.context?.testComponentId || '').trim() &&
    linkedTestComponents.includes(String(input.context?.testComponentId || '').trim());

  if (inControlContext || inTestContext) {
    relevance += 10;
    relevanceSignals.push('LINKED_TO_CONTEXT');
  } else if (linkedControls.length > 0 && !input.context?.controlId && !input.context?.testComponentId) {
    relevance += 10;
    relevanceSignals.push('LINKED_CONTEXT_FALLBACK');
  }

  if (linkedRequests.length > 0) {
    relevance += 5;
    relevanceSignals.push('FULFILLS_REQUEST');
  } else {
    pushFix(fixes, {
      code: 'CREATE_SUPPORTING_REQUEST',
      msg: 'Create or fulfill an evidence request to improve traceability.',
      suggestedAction: 'CREATE_REQUEST',
    });
  }
  relevance = clamp(relevance, 0, MAX_RELEVANCE);

  const reliabilityModel = reliabilityPointsForType(input.evidence.type);
  const reliability = clamp(reliabilityModel.points, 0, MAX_RELIABILITY);
  const reliabilitySignals = [`TYPE_${reliabilityModel.canonical}_${reliability}`];
  if (reliability <= 12) {
    pushReason(reasons, {
      code: 'WEAK_EVIDENCE_TYPE',
      msg: 'Evidence type has low reliability strength.',
      severity: 'warn',
    });
    pushFix(fixes, {
      code: 'USE_STRONGER_EVIDENCE',
      msg: 'Re-upload stronger evidence such as logs or system reports.',
      suggestedAction: 'REUPLOAD',
    });
  }

  let freshness = MAX_FRESHNESS;
  const freshnessSignals: string[] = [];
  const validTo = toDateOrNull(input.evidence.validTo);
  if (validTo && validTo.getTime() < now.getTime()) {
    freshness = 0;
    freshnessSignals.push('EXPIRED_VALID_TO');
    pushReason(reasons, {
      code: 'EVIDENCE_EXPIRED',
      msg: 'Evidence validity has expired.',
      severity: 'blocker',
    });
    pushFix(fixes, {
      code: 'REUPLOAD_FRESH_EVIDENCE',
      msg: 'Upload an updated evidence file with a fresh validity period.',
      suggestedAction: 'REUPLOAD',
    });
  } else {
    const cadence = cadenceFromFrequency(Math.max(1, Number(input.frequencyDays || 90)));
    const anchor = toDateOrNull(input.evidence.validFrom) || toDateOrNull(input.evidence.createdAt) || now;
    const days = ageInDays(anchor, now);
    const band = freshnessByCadence(cadence, days);
    freshness = band.points;
    freshnessSignals.push(`CADENCE_${cadence}`);
    freshnessSignals.push(`AGE_DAYS_${days}`);

    if (band.band === 'BORDERLINE') {
      pushReason(reasons, {
        code: 'EVIDENCE_AGE_BORDERLINE',
        msg: 'Evidence is aging relative to review cadence.',
        severity: 'warn',
      });
      pushFix(fixes, {
        code: 'REFRESH_EVIDENCE_SOON',
        msg: 'Refresh evidence before the next review cycle.',
        suggestedAction: 'REUPLOAD',
      });
    }

    if (band.band === 'STALE') {
      pushReason(reasons, {
        code: 'EVIDENCE_STALE',
        msg: 'Evidence is stale for the control cadence.',
        severity: 'warn',
      });
      pushFix(fixes, {
        code: 'REUPLOAD_STALE_EVIDENCE',
        msg: 'Upload newer evidence to improve freshness.',
        suggestedAction: 'REUPLOAD',
      });
    }
  }
  freshness = clamp(freshness, 0, MAX_FRESHNESS);

  let completeness = MAX_COMPLETENESS;
  const completenessSignals: string[] = [];

  const status = String(input.evidence.status || '').toUpperCase();
  const hasReviewer = !!String(input.evidence.reviewedById || '').trim();
  if ((status === 'ACCEPTED' || status === 'REVIEWED') && !hasReviewer) {
    completeness -= 5;
    completenessSignals.push('MISSING_REVIEWER');
    pushReason(reasons, {
      code: 'MISSING_REVIEWER',
      msg: 'Evidence status requires reviewer attribution.',
      severity: 'warn',
    });
    pushFix(fixes, {
      code: 'ADD_REVIEWER',
      msg: 'Complete review with reviewer identity.',
      suggestedAction: 'ADD_METADATA',
    });
  }

  const hasReviewComment = !!String(input.evidence.reviewComment || '').trim();
  if ((status === 'ACCEPTED' || status === 'REJECTED') && !hasReviewComment) {
    completeness -= 5;
    completenessSignals.push('MISSING_REVIEW_COMMENT');
    pushReason(reasons, {
      code: 'MISSING_REVIEW_COMMENT',
      msg: 'Review comment is required for accepted/rejected evidence.',
      severity: 'warn',
    });
    pushFix(fixes, {
      code: 'ADD_REVIEW_COMMENT',
      msg: 'Add review comment to explain acceptance/rejection.',
      suggestedAction: 'ADD_METADATA',
    });
  }

  if (linkedControls.length === 0) {
    completeness -= 10;
    completenessSignals.push('MISSING_CONTROL_LINKS');
  }

  const missingMetadata = metadataMissingFields(input.evidence);
  if (missingMetadata.length) {
    const penalty = missingMetadata.length >= 2 ? 10 : 5;
    completeness -= penalty;
    completenessSignals.push(`MISSING_METADATA_${missingMetadata.join('_').toUpperCase()}`);
    pushReason(reasons, {
      code: 'MISSING_METADATA',
      msg: `Evidence metadata is incomplete: ${missingMetadata.join(', ')}.`,
      severity: 'warn',
    });
    pushFix(fixes, {
      code: 'COMPLETE_METADATA',
      msg: 'Complete required evidence metadata fields.',
      suggestedAction: 'ADD_METADATA',
    });
  }

  completeness = clamp(completeness, 0, MAX_COMPLETENESS);

  const total = clamp(relevance + reliability + freshness + completeness, 0, 100);
  const grade = gradeFromScore(total);

  if (grade === 'WEAK') {
    pushReason(reasons, {
      code: 'QUALITY_WEAK',
      msg: 'Evidence quality is weak and cannot support a pass state.',
      severity: 'blocker',
    });
  } else if (grade === 'MEDIUM') {
    pushReason(reasons, {
      code: 'QUALITY_MEDIUM',
      msg: 'Evidence quality is medium and may result in partial status.',
      severity: 'info',
    });
  }

  const factors: EvidenceQualityFactors = {
    version: QUALITY_VERSION,
    relevance: {
      points: relevance,
      max: MAX_RELEVANCE,
      signals: relevanceSignals,
    },
    reliability: {
      points: reliability,
      max: MAX_RELIABILITY,
      signals: reliabilitySignals,
    },
    freshness: {
      points: freshness,
      max: MAX_FRESHNESS,
      signals: freshnessSignals,
    },
    completeness: {
      points: completeness,
      max: MAX_COMPLETENESS,
      signals: completenessSignals,
    },
    reasons,
    fixes,
    coverage: {
      linkedControls,
      linkedRequests,
      linkedTestComponents,
    },
  };

  return {
    score: total,
    grade,
    factors,
  };
};

@Injectable()
export class EvidenceQualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  isEnabled() {
    return this.featureFlags.isEnabled('evidenceQualityV1');
  }

  async getEvidenceQuality(params: {
    evidenceId: string;
    context?: QualityContext;
  }): Promise<EvidenceQualityPayload> {
    if (!this.isEnabled()) {
      return this.getStoredOrFallbackQuality(params.evidenceId);
    }

    if (params.context?.controlId || params.context?.testComponentId) {
      const computed = await this.computeFromDatabase(params.evidenceId, params.context);
      return {
        score: computed.score,
        grade: computed.grade,
        factors: computed.factors,
        computedAt: new Date().toISOString(),
        version: QUALITY_VERSION,
      };
    }

    return this.recomputeEvidenceQuality({
      evidenceId: params.evidenceId,
      actor: null,
      reason: 'AUTO_RECOMPUTE_ON_READ',
      requestId: null,
      force: false,
    });
  }

  async recomputeEvidenceQuality(params: {
    evidenceId: string;
    actor?: AuthUser | null;
    reason?: string | null;
    requestId?: string | null;
    force?: boolean;
  }): Promise<EvidenceQualityPayload> {
    if (!this.isEnabled()) {
      return this.getStoredOrFallbackQuality(params.evidenceId);
    }

    const evidenceId = String(params.evidenceId || '').trim();
    const row = await this.getEvidenceRowById(evidenceId);

    const current = this.toStoredPayload(row);
    const currentVersion = Number(row.qualityVersion || 0);
    const lastComputedAt = toDateOrNull(row.qualityComputedAt);
    const force = params.force === true;

    if (
      !force &&
      current.score !== null &&
      current.grade !== null &&
      current.factors !== null &&
      currentVersion === QUALITY_VERSION &&
      lastComputedAt &&
      Date.now() - lastComputedAt.getTime() < RECALC_COOLDOWN_MS
    ) {
      return {
        score: current.score,
        grade: current.grade,
        factors: current.factors,
        computedAt: row.qualityComputedAt || new Date().toISOString(),
        version: QUALITY_VERSION,
      };
    }

    const computed = await this.computeFromDatabase(evidenceId);
    const nextPayload: EvidenceQualityPayload = {
      score: computed.score,
      grade: computed.grade,
      factors: computed.factors,
      computedAt: new Date().toISOString(),
      version: QUALITY_VERSION,
    };

    const changed =
      current.score !== nextPayload.score ||
      current.grade !== nextPayload.grade ||
      JSON.stringify(current.factors || null) !== JSON.stringify(nextPayload.factors) ||
      currentVersion !== QUALITY_VERSION;

    if (!changed && row.qualityComputedAt) {
      return {
        score: current.score ?? nextPayload.score,
        grade: (current.grade as EvidenceQualityGrade | null) ?? nextPayload.grade,
        factors: current.factors ?? nextPayload.factors,
        computedAt: row.qualityComputedAt,
        version: QUALITY_VERSION,
      };
    }

    await this.prisma.$executeRaw`
      UPDATE "Evidence"
      SET
        qualityScore = ${nextPayload.score},
        qualityGrade = ${nextPayload.grade},
        qualityFactors = ${JSON.stringify(nextPayload.factors)},
        qualityComputedAt = ${nextPayload.computedAt},
        qualityVersion = ${QUALITY_VERSION},
        updatedAt = datetime('now')
      WHERE id = ${evidenceId}
    `;

    await this.audit.log({
      actorId: params.actor?.id || null,
      actorRole: params.actor?.role || null,
      actionType: 'EVIDENCE_QUALITY_RECOMPUTE',
      entityType: 'Evidence',
      entityId: evidenceId,
      before: this.auditSnapshot(current),
      after: this.auditSnapshot(nextPayload),
      reason: params.reason || null,
      requestId: params.requestId || null,
    });

    return nextPayload;
  }

  private async computeFromDatabase(evidenceId: string, context?: QualityContext) {
    const row = await this.getEvidenceRowById(evidenceId);

    const [links, fulfillments, schedules] = await Promise.all([
      this.prisma.$queryRaw<Array<{ controlId: string }>>`
        SELECT controlId
        FROM "EvidenceControlLink"
        WHERE evidenceId = ${evidenceId}
      `,
      this.prisma.$queryRaw<Array<{ requestId: string; testComponentId: string | null }>>`
        SELECT
          f.requestId,
          r.testComponentId
        FROM "EvidenceRequestFulfillment" f
        LEFT JOIN "ControlEvidenceRequest" r ON r.id = f.requestId
        WHERE f.evidenceId = ${evidenceId}
      `,
      this.prisma.$queryRaw<Array<{ frequencyDays: number }>>`
        SELECT s.frequencyDays
        FROM "ControlSchedule" s
        INNER JOIN "EvidenceControlLink" l ON l.controlId = s.controlId
        WHERE l.evidenceId = ${evidenceId}
      `,
    ]);

    const linkedControls = uniq(links.map((rowItem) => rowItem.controlId));
    const linkedRequests = uniq(fulfillments.map((rowItem) => rowItem.requestId));
    const linkedTestComponents = uniq(fulfillments.map((rowItem) => rowItem.testComponentId));
    const frequencyDays =
      schedules.length > 0
        ? Math.max(1, Math.min(...schedules.map((item) => Number(item.frequencyDays || 90)).filter((value) => Number.isFinite(value))))
        : 90;

    return buildEvidenceQuality({
      evidence: {
        id: row.id,
        title: row.title,
        type: row.type,
        source: row.source,
        documentId: row.documentId,
        url: row.url,
        status: row.status,
        createdAt: row.createdAt,
        validFrom: row.validFrom,
        validTo: row.validTo,
        reviewedById: row.reviewedById,
        reviewComment: row.reviewComment,
      },
      coverage: {
        linkedControls,
        linkedRequests,
        linkedTestComponents,
      },
      frequencyDays,
      context,
      now: new Date(),
    });
  }

  private async getStoredOrFallbackQuality(evidenceId: string): Promise<EvidenceQualityPayload> {
    const row = await this.getEvidenceRowById(evidenceId);
    const stored = this.toStoredPayload(row);
    if (stored.score !== null && stored.grade && stored.factors) {
      return {
        score: stored.score,
        grade: stored.grade,
        factors: stored.factors,
        computedAt: row.qualityComputedAt || new Date().toISOString(),
        version: Number(row.qualityVersion || QUALITY_VERSION),
      };
    }

    const fallback = await this.computeFromDatabase(evidenceId);
    return {
      score: fallback.score,
      grade: fallback.grade,
      factors: fallback.factors,
      computedAt: new Date().toISOString(),
      version: QUALITY_VERSION,
    };
  }

  private toStoredPayload(row: EvidenceRow): {
    score: number | null;
    grade: EvidenceQualityGrade | null;
    factors: EvidenceQualityFactors | null;
  } {
    const gradeRaw = String(row.qualityGrade || '').toUpperCase();
    const grade =
      gradeRaw === 'STRONG' || gradeRaw === 'MEDIUM' || gradeRaw === 'WEAK'
        ? (gradeRaw as EvidenceQualityGrade)
        : null;
    const score = row.qualityScore == null ? null : Number(row.qualityScore);
    const factors = this.parseFactors(row.qualityFactors);
    return {
      score: Number.isFinite(score as number) ? score : null,
      grade,
      factors,
    };
  }

  private parseFactors(value: unknown): EvidenceQualityFactors | null {
    if (!value) return null;
    const parsed = typeof value === 'string' ? this.tryParseJson(value) : value;
    if (!parsed || typeof parsed !== 'object') return null;

    const data = parsed as any;
    if (!data.relevance || !data.reliability || !data.freshness || !data.completeness || !data.coverage) {
      return null;
    }
    return data as EvidenceQualityFactors;
  }

  private tryParseJson(value: string) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private auditSnapshot(
    payload:
      | {
          score: number | null;
          grade: EvidenceQualityGrade | null;
          factors: EvidenceQualityFactors | null;
        }
      | EvidenceQualityPayload,
  ) {
    const factors = payload.factors;
    const reasonCodes = Array.isArray(factors?.reasons) ? factors.reasons.map((reason) => reason.code) : [];
    return {
      score: payload.score,
      grade: payload.grade,
      version: factors?.version || QUALITY_VERSION,
      dimensions: factors
        ? {
            relevance: factors.relevance.points,
            reliability: factors.reliability.points,
            freshness: factors.freshness.points,
            completeness: factors.completeness.points,
          }
        : null,
      reasonCodes,
    };
  }

  private async getEvidenceRowById(evidenceId: string): Promise<EvidenceRow> {
    const rows = await this.prisma.$queryRaw<EvidenceRow[]>`
      SELECT
        id,
        title,
        type,
        source,
        documentId,
        url,
        status,
        createdAt,
        validFrom,
        validTo,
        reviewedById,
        reviewComment,
        qualityScore,
        qualityGrade,
        qualityFactors,
        qualityComputedAt,
        qualityVersion
      FROM "Evidence"
      WHERE id = ${evidenceId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      throw new NotFoundException('Evidence not found');
    }
    return row;
  }
}

export const EVIDENCE_QUALITY_RULE_VERSION = QUALITY_VERSION;
