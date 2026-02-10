import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type RiskControl = {
  controlId: string;
  controlDbId?: string | null;
  title?: string | null;
  status: string;
  summary: string;
  updatedAt: string;
};

type ActivityItem = {
  label: string;
  detail: string;
  time: string;
};

type EvidenceHealth = {
  high: number;
  medium: number;
  low: number;
  score: number;
  total: number;
};

type EvidenceHealthDetail = {
  expiringSoon: number;
  expired: number;
  missing: number;
  reusedAcrossFrameworks: number;
  rejected: number;
  outdated: number;
};

type EvidenceHealthVisual = {
  valid: number;
  expiringSoon: number;
  expired: number;
  missing: number;
  total: number;
};

type AuditReadiness = {
  percent: number;
  acceptedControls: number;
  totalControls: number;
  missingPolicies: number;
  missingLogs: number;
};

type SubmissionReadiness = {
  percent: number;
  submitted: number;
  reviewed: number;
};

type ComplianceBreakdown = {
  compliant: number;
  partial: number;
  notCompliant: number;
  unknown: number;
  total: number;
  compliantPct: number;
  partialPct: number;
  notCompliantPct: number;
  unknownPct: number;
};

type RiskCoverage = {
  id: string;
  title: string;
  coveragePercent: number;
  controlCount: number;
  missingCount: number;
  controlCodes: string[];
};

type RiskHeatmap = {
  impactLabels: string[];
  likelihoodLabels: string[];
  matrix: number[][];
};

type RiskDistribution = {
  high: number;
  medium: number;
  low: number;
  total: number;
  exposure: 'high' | 'medium' | 'low';
};

type RiskDriver = {
  id: 'missing-evidence' | 'owner-not-assigned' | 'control-not-tested';
  label: string;
  count: number;
};

type AttentionItem = {
  id: string;
  label: string;
  count: number;
  severity: 'high' | 'medium' | 'low';
  route: string;
  query?: Record<string, string>;
};

type TrendSeries = {
  label: string;
  points: number[];
};

type FrameworkComparison = {
  framework: string;
  completionPercent: number;
  failedControls: number;
};

type RecommendedAction = {
  id: string;
  title: string;
  reason: string;
  route: string;
  query?: Record<string, string>;
  severity: 'high' | 'medium' | 'low';
};

type ComplianceGapItem = {
  id: 'missing-evidence' | 'control-not-implemented' | 'control-not-tested' | 'owner-not-assigned' | 'outdated-policy';
  label: string;
  count: number;
  route: string;
  query?: Record<string, string>;
};

type FrameworkProgress = {
  framework: string;
  series: number[];
};

type UploadSummary = {
  totalUploadedDocuments: number;
  distinctMatchedControls: number;
  documentsPerControl: Array<{
    controlId: string;
    count: number;
  }>;
};

type AttentionTodayItem = {
  id: string;
  label: string;
  count: number;
  severity: 'high' | 'medium' | 'low';
  kind: 'control' | 'risk' | 'evidence' | 'audit';
  dueInDays?: number | null;
  route: string;
  query?: Record<string, string>;
};

type DashboardFilterOptions = {
  frameworks: string[];
  businessUnits: string[];
  riskCategories: string[];
  timeRanges: number[];
};

type DashboardKpi = {
  id: string;
  label: string;
  value: string;
  note?: string;
  severity?: 'high' | 'medium' | 'low';
  trend?: { direction: 'up' | 'down' | 'flat'; delta?: number };
  drilldown?: { route: string; query?: Record<string, string>; label?: string };
};

type TrendSeriesV2 = {
  id: 'riskScore' | 'compliance' | 'mttr';
  label: string;
  points: number[];
  dates: string[];
  rangeDays: number;
  unit: 'percent' | 'days';
};

type FrameworkComparisonV2 = {
  framework: string;
  totalControls: number;
  compliant: number;
  partial: number;
  notCompliant: number;
  unknown: number;
  completionPercent: number;
  failedControls: number;
};

type RecommendedActionV2 = {
  id: string;
  title: string;
  reason: string;
  route: string;
  query?: Record<string, string>;
  severity: 'high' | 'medium' | 'low';
  cta?: string;
};

type UpcomingAudit = {
  id: string;
  name: string;
  framework?: string | null;
  date: string;
  daysUntil: number;
  route: string;
  query?: Record<string, string>;
};

type AuditSummary = {
  upcoming14: number;
  upcoming30: number;
  upcoming90: number;
  upcoming: UpcomingAudit[];
};

type ExecutiveSummary = {
  headline: string;
  highlights: string[];
  risks: string[];
  lastUpdated: string;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private chunk<T>(items: T[], size = 900) {
    if (!items.length) return [];
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  private isGovernanceControl(controlCode: string, topicTitle: string | null | undefined) {
    const normalized = `${controlCode} ${topicTitle || ''}`.toLowerCase();
    return (
      normalized.includes('governance') ||
      normalized.startsWith('gov') ||
      normalized.includes('risk management')
    );
  }

  private classifyEvidenceType(value: string, isGovernance: boolean) {
    const normalized = (value || '').toLowerCase();
    if (!normalized) return 'low' as const;
    const highKeywords = ['log', 'logs', 'config', 'configuration', 'ticket', 'record', 'records'];
    const mediumKeywords = ['policy', 'procedure', 'process', 'guideline', 'standard', 'plan'];

    if (highKeywords.some((term) => normalized.includes(term))) return 'high' as const;
    if (mediumKeywords.some((term) => normalized.includes(term))) {
      return isGovernance ? ('high' as const) : ('medium' as const);
    }
    return 'low' as const;
  }

  private resolveImpactLevel(status: string) {
    const normalized = (status || '').toUpperCase();
    if (normalized === 'NOT_COMPLIANT') return 3;
    if (normalized === 'PARTIAL') return 2;
    if (normalized === 'COMPLIANT') return 1;
    return 2;
  }

  private resolveLikelihoodLevel(lastSeen?: Date | null) {
    if (!lastSeen) return 2;
    const days = Math.max(0, Math.floor((Date.now() - lastSeen.getTime()) / 86400000));
    if (days <= 14) return 1;
    if (days <= 90) return 2;
    return 3;
  }

  private buildHeatmapMatrix() {
    return Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => 0));
  }

  private buildMonthSeries(count = 6) {
    const now = new Date();
    const months: Array<{ key: string; label: string; end: Date }> = [];
    for (let i = count - 1; i >= 0; i -= 1) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 59, 59));
      const label = date.toLocaleString('en-US', { month: 'short' });
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      months.push({ key, label, end: date });
    }
    return months;
  }

  private buildDaySeries(rangeDays: number) {
    const days = Math.min(Math.max(rangeDays, 7), 365);
    const now = new Date();
    const list: Array<{ label: string; end: Date }> = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const end = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - i,
        23,
        59,
        59,
      ));
      list.push({ label: end.toISOString().slice(0, 10), end });
    }
    return list;
  }

  private buildTrendsV2(params: {
    rangeDays: number;
    controlCodes: string[];
    eventByControl: Map<string, Array<{ createdAt: Date; status: string }>>;
    partialWeight: number;
  }): TrendSeriesV2[] {
    const { rangeDays, controlCodes, eventByControl, partialWeight } = params;
    const days = this.buildDaySeries(rangeDays);
    const dates = days.map((item) => item.label);
    const compliance = days.map((item) =>
      this.computeCompliancePercentAt(controlCodes, eventByControl, item.end, partialWeight),
    );
    const riskScore = compliance.map((value) => Math.max(0, 100 - value));
    const mttr = days.map((item) => this.computeMttrAt(controlCodes, eventByControl, item.end));

    return [
      { id: 'riskScore', label: 'Risk Score', points: riskScore, dates, rangeDays, unit: 'percent' },
      { id: 'compliance', label: 'Compliance', points: compliance, dates, rangeDays, unit: 'percent' },
      { id: 'mttr', label: 'MTTR', points: mttr, dates, rangeDays, unit: 'days' },
    ];
  }

  private computeCompliancePercentAt(
    controlCodes: string[],
    eventsByControl: Map<string, Array<{ createdAt: Date; status: string }>>,
    monthEnd: Date,
    partialWeight: number,
  ) {
    if (!controlCodes.length) return 0;
    let sum = 0;
    for (const code of controlCodes) {
      const events = eventsByControl.get(code) || [];
      const match = events.find((item) => item.createdAt.getTime() <= monthEnd.getTime());
      const status = match?.status || 'UNKNOWN';
      if (status === 'COMPLIANT') sum += 1;
      else if (status === 'PARTIAL') sum += partialWeight;
    }
    return Math.round((sum / controlCodes.length) * 100);
  }

  private computeMttrAt(
    controlCodes: string[],
    eventsByControl: Map<string, Array<{ createdAt: Date; status: string }>>,
    monthEnd: Date,
  ) {
    let totalDays = 0;
    let count = 0;
    for (const code of controlCodes) {
      const events = (eventsByControl.get(code) || [])
        .filter((item) => item.createdAt.getTime() <= monthEnd.getTime())
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      if (!events.length) continue;
      for (let i = 0; i < events.length; i += 1) {
        if (events[i].status !== 'NOT_COMPLIANT') continue;
        const start = events[i].createdAt;
        const resolved = events.slice(i + 1).find((entry) => entry.status === 'COMPLIANT');
        if (!resolved) continue;
        const days = Math.max(0, Math.round((resolved.createdAt.getTime() - start.getTime()) / 86400000));
        totalDays += days;
        count += 1;
        break;
      }
    }
    return count ? Math.round(totalDays / count) : 0;
  }

  private buildEmptyDashboard(params: {
    frameworkScope: string | null;
    filters?: {
      framework?: string | null;
      businessUnit?: string | null;
      riskCategory?: string | null;
      rangeDays?: number;
    };
    filterOptions: DashboardFilterOptions;
    rangeDays: number;
  }) {
    const { frameworkScope, filters, filterOptions, rangeDays } = params;
    const partialWeight = 0.6;
    const trendDays = this.buildDaySeries(rangeDays);
    const trendDates = trendDays.map((item) => item.label);
    const months = this.buildMonthSeries(6).map((month) => month.label);
    const comparisonTargets = ['ISO 27001', 'SOC 2', 'NIST'];

    const evidenceHealth: EvidenceHealth = {
      high: 0,
      medium: 0,
      low: 0,
      score: 0,
      total: 0,
    };

    const auditReadiness: AuditReadiness = {
      percent: 0,
      acceptedControls: 0,
      totalControls: 0,
      missingPolicies: 0,
      missingLogs: 0,
    };

    const submissionReadiness: SubmissionReadiness = {
      percent: 0,
      submitted: 0,
      reviewed: 0,
    };

    const complianceBreakdown: ComplianceBreakdown = {
      compliant: 0,
      partial: 0,
      notCompliant: 0,
      unknown: 0,
      total: 0,
      compliantPct: 0,
      partialPct: 0,
      notCompliantPct: 0,
      unknownPct: 0,
    };

    const evidenceHealthDetail: EvidenceHealthDetail = {
      expiringSoon: 0,
      expired: 0,
      missing: 0,
      reusedAcrossFrameworks: 0,
      rejected: 0,
      outdated: 0,
    };

    const evidenceHealthDetailV2 = {
      expiringIn30: 0,
      expired: 0,
      missing: 0,
      reusedAcrossFrameworks: 0,
      rejected: 0,
      outdated: 0,
    };

    const riskHeatmap: RiskHeatmap = {
      impactLabels: ['Low', 'Medium', 'High'],
      likelihoodLabels: ['Low', 'Medium', 'High'],
      matrix: this.buildHeatmapMatrix(),
    };

    const riskDistribution: RiskDistribution = {
      high: 0,
      medium: 0,
      low: 0,
      total: 0,
      exposure: 'low',
    };

    const attentionToday: AttentionTodayItem[] = [
      {
        id: 'failed-controls',
        label: 'Failed Controls',
        count: 0,
        severity: 'low',
        kind: 'control',
        route: '/control-kb',
        query: { status: 'enabled' },
      },
      {
        id: 'missing-evidence',
        label: 'Missing Evidence',
        count: 0,
        severity: 'low',
        kind: 'evidence',
        route: '/uploads',
      },
      {
        id: 'risks-without-owner',
        label: 'Risks Without Owner',
        count: 0,
        severity: 'low',
        kind: 'risk',
        route: '/dashboard',
      },
      {
        id: 'upcoming-audits',
        label: 'Upcoming Audits',
        count: 0,
        severity: 'low',
        kind: 'audit',
        route: '/dashboard',
        query: { range: '30' },
      },
    ];

    const attentionItems: AttentionItem[] = [
      {
        id: 'failed-controls',
        label: 'Controls failed',
        count: 0,
        severity: 'low',
        route: '/control-kb',
        query: { status: 'enabled' },
      },
      {
        id: 'overdue-controls',
        label: 'Overdue controls',
        count: 0,
        severity: 'low',
        route: '/control-kb',
        query: { status: 'enabled' },
      },
      {
        id: 'risks-without-mitigation',
        label: 'Risks without mitigation',
        count: 0,
        severity: 'low',
        route: '/dashboard',
      },
      {
        id: 'evidence-issues',
        label: 'Evidence missing/expired',
        count: 0,
        severity: 'low',
        route: '/uploads',
      },
      {
        id: 'upcoming-audits',
        label: 'Audits in next 30 days',
        count: 0,
        severity: 'low',
        route: '/dashboard',
      },
    ];

    const trends = {
      riskScore: months.map(() => 0),
      compliance: months.map(() => 0),
      mttr: months.map(() => 0),
    };

    const trendsV2: TrendSeriesV2[] = [
      { id: 'riskScore', label: 'Risk Score', points: trendDates.map(() => 0), dates: trendDates, rangeDays, unit: 'percent' },
      { id: 'compliance', label: 'Compliance', points: trendDates.map(() => 0), dates: trendDates, rangeDays, unit: 'percent' },
      { id: 'mttr', label: 'MTTR', points: trendDates.map(() => 0), dates: trendDates, rangeDays, unit: 'days' },
    ];

    const frameworkComparison: FrameworkComparison[] = comparisonTargets.map((framework) => ({
      framework,
      completionPercent: 0,
      failedControls: 0,
    }));

    const frameworkComparisonV2: FrameworkComparisonV2[] = comparisonTargets.map((framework) => ({
      framework,
      totalControls: 0,
      compliant: 0,
      partial: 0,
      notCompliant: 0,
      unknown: 0,
      completionPercent: 0,
      failedControls: 0,
    }));

    const auditSummary: AuditSummary = {
      upcoming14: 0,
      upcoming30: 0,
      upcoming90: 0,
      upcoming: [],
    };

    const kpis: DashboardKpi[] = [
      {
        id: 'coverage',
        label: 'Overall Coverage',
        value: '0%',
        note: '0/0 controls reviewed',
        severity: 'low',
        drilldown: { route: '/control-kb', query: { status: 'enabled' } },
      },
      {
        id: 'evidence-health',
        label: 'Evidence Health Score',
        value: '0%',
        note: 'High 0 | Medium 0 | Low 0',
        severity: 'low',
        drilldown: { route: '/uploads' },
      },
      {
        id: 'audit-readiness',
        label: 'Audit Readiness',
        value: '0%',
        note: 'Missing policies 0 | Missing logs 0',
        severity: 'low',
        drilldown: { route: '/uploads' },
      },
      {
        id: 'submission-readiness',
        label: 'Submission Readiness',
        value: '0%',
        note: '0/0 submitted',
        severity: 'low',
        drilldown: { route: '/uploads' },
      },
      {
        id: 'overdue-evidence',
        label: 'Overdue Evidence',
        value: '0',
        note: 'Awaiting review >14 days',
        severity: 'low',
        drilldown: { route: '/uploads' },
      },
      {
        id: 'open-risks',
        label: 'Open Risks',
        value: '0',
        note: 'Partial or missing controls',
        severity: 'low',
        drilldown: { route: '/dashboard' },
      },
      {
        id: 'documents-uploaded',
        label: 'Documents Uploaded',
        value: '0',
        note: 'Total evidence files',
        severity: 'low',
        drilldown: { route: '/uploads' },
      },
      {
        id: 'matched-controls',
        label: 'Matched Controls',
        value: '0',
        note: 'Distinct controls with uploads',
        severity: 'low',
        drilldown: { route: '/control-kb', query: { compliance: 'COMPLIANT' } },
      },
    ];

    const executiveSummary: ExecutiveSummary = {
      headline: '0% coverage across 0 controls',
      highlights: [
        '0 compliant | 0 partial | 0 failed',
        'Evidence health 0%',
        'Audit readiness 0%',
      ],
      risks: [
        'No active framework selected',
        'Activate a framework to start measuring controls',
      ],
      lastUpdated: new Date().toISOString(),
    };

    return {
      ok: true,
      appliedFilters: {
        framework: frameworkScope,
        businessUnit: filters?.businessUnit || null,
        riskCategory: filters?.riskCategory || null,
        rangeDays,
      },
      filterOptions,
      attentionToday,
      attentionItems,
      evidenceHealthDetail,
      evidenceHealthDetailV2,
      trends,
      trendsV2,
      frameworkComparison,
      frameworkComparisonV2,
      recommendedActions: [] as RecommendedAction[],
      recommendedActionsV2: [] as RecommendedActionV2[],
      auditSummary,
      kpis,
      executiveSummary,
      complianceGaps: [] as ComplianceGapItem[],
      metrics: {
        coveragePercent: 0,
        evaluatedControls: 0,
        compliant: 0,
        partial: 0,
        missing: 0,
        unknown: 0,
        evidenceItems: 0,
        awaitingReview: 0,
        openRisks: 0,
        overdueEvidence: 0,
        lastReviewAt: null,
        evidenceHealth,
        auditReadiness,
        submissionReadiness,
      },
      uploadSummary: {
        totalUploadedDocuments: 0,
        distinctMatchedControls: 0,
        documentsPerControl: [],
      },
      complianceBreakdown,
      riskDrivers: [] as RiskDriver[],
      riskHeatmap,
      riskHeatmapControls: [],
      riskDistribution,
      evidenceHealthVisual: {
        valid: 0,
        expiringSoon: 0,
        expired: 0,
        missing: 0,
        total: 0,
      },
      frameworkProgress: [] as FrameworkProgress[],
      months,
      riskCoverage: [] as RiskCoverage[],
      riskControls: [] as RiskControl[],
      activity: [] as ActivityItem[],
    };
  }

  async getDashboard(filters?: {
    framework?: string | null;
    businessUnit?: string | null;
    riskCategory?: string | null;
    rangeDays?: number;
  }) {
    const rangeDaysRaw = Number(filters?.rangeDays || 90);
    const rangeDays = Number.isFinite(rangeDaysRaw)
      ? Math.min(Math.max(rangeDaysRaw, 30), 365)
      : 90;

    const activeFramework = await this.prisma.framework.findFirst({
      where: { status: 'enabled' },
      orderBy: { updatedAt: 'desc' },
      select: { name: true },
    });

    const activeFrameworkName = String(activeFramework?.name || '').trim();
    const requestedFramework = String(filters?.framework || '').trim();
    const frameworkScope = requestedFramework || activeFrameworkName;

    const frameworkOptions = await this.prisma.framework.findMany({
      select: { name: true },
      orderBy: { name: 'asc' },
    });

    const filterOptions: DashboardFilterOptions = {
      frameworks: Array.from(new Set(frameworkOptions.map((fw) => fw.name).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
      businessUnits: [],
      riskCategories: [],
      timeRanges: [30, 90, 180, 365],
    };

    if (!frameworkScope) {
      return this.buildEmptyDashboard({
        frameworkScope: null,
        filters,
        filterOptions,
        rangeDays,
      });
    }

    const controls = await this.prisma.controlDefinition.findMany({
      where: {
        status: 'enabled',
        ...(frameworkScope
          ? { frameworkMappings: { some: { framework: frameworkScope } } }
          : {}),
      },
      select: {
        id: true,
        controlCode: true,
        title: true,
        ownerRole: true,
        topic: { select: { title: true } },
        frameworkMappings: { select: { framework: true } },
      },
    });

    const allowedControls = controls;

    const allowedControlCodes = allowedControls.map((control) => control.controlCode);
    const allowedControlCodeSet = new Set(allowedControlCodes);
    const allowedControlIds = allowedControls.map((control) => control.id);
    const controlIdToCode = new Map<string, string>();
    const controlCodeToId = new Map<string, string>();
    const controlCodeToTitle = new Map<string, string>();
    for (const control of allowedControls) {
      controlIdToCode.set(control.id, control.controlCode);
      controlCodeToId.set(control.controlCode, control.id);
      controlCodeToTitle.set(control.controlCode, control.title || control.controlCode);
    }

    const evaluations = await this.prisma.evidenceEvaluation.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const latestByControl = new Map<string, (typeof evaluations)[number]>();
    for (const evaluation of evaluations) {
      if (!latestByControl.has(evaluation.controlId)) {
        latestByControl.set(evaluation.controlId, evaluation);
      }
    }

    const latestEvaluations = Array.from(latestByControl.values()).filter((evaluation) =>
      allowedControlCodeSet.has(String(evaluation.controlId)),
    );
    const statusCounts = {
      COMPLIANT: 0,
      PARTIAL: 0,
      NOT_COMPLIANT: 0,
      UNKNOWN: 0,
    };

    const statusByControlCode = new Map<string, string>();
    const lastSeenByControl = new Map<string, Date>();
    for (const evaluation of latestEvaluations) {
      const controlCode = String(evaluation.controlId);
      const status = String(evaluation.status || '').toUpperCase();
      statusByControlCode.set(controlCode, status);
      lastSeenByControl.set(controlCode, evaluation.createdAt);
    }

    const totalControls = allowedControls.length;
    const partialWeight = 0.6;

    let totalDocuments = 0;
    let awaitingReview = 0;
    const documents: Array<{
      matchControlId: string | null;
      docType: string | null;
      originalName: string;
      matchStatus: string | null;
      reviewedAt: Date | null;
      submittedAt: Date | null;
      createdAt: Date;
      conversation?: { title: string } | null;
    }> = [];

    if (allowedControlCodes.length) {
      for (const chunk of this.chunk(allowedControlCodes)) {
        const [chunkTotal, chunkAwaiting, chunkDocs] = await Promise.all([
          this.prisma.document.count({ where: { matchControlId: { in: chunk } } }),
          this.prisma.document.count({ where: { matchControlId: { in: chunk }, reviewedAt: null } }),
          this.prisma.document.findMany({
            where: { matchControlId: { in: chunk } },
            select: {
              matchControlId: true,
              docType: true,
              originalName: true,
              matchStatus: true,
              reviewedAt: true,
              submittedAt: true,
              createdAt: true,
              conversation: { select: { title: true } },
            },
          }),
        ]);
        totalDocuments += chunkTotal;
        awaitingReview += chunkAwaiting;
        documents.push(...chunkDocs);
      }
    }

    const lastReviewAt = evaluations[0]?.createdAt ?? null;

    const docsByControl = new Map<string, typeof documents>();
    const latestDocByControl = new Map<string, { status: string; createdAt: Date; docType: string | null; originalName: string }>();
    const acceptedControls = new Set<string>();
    let reviewedDocs = 0;
    let submittedDocs = 0;
    for (const doc of documents) {
      const controlCode = String(doc.matchControlId || '');
      if (!controlCode) continue;
      const list = docsByControl.get(controlCode) || [];
      list.push(doc);
      docsByControl.set(controlCode, list);
      const normalizedStatus = String(doc.matchStatus || '').toUpperCase();
      if (normalizedStatus) {
        const existing = latestDocByControl.get(controlCode);
        const docTimestamp = doc.reviewedAt || doc.submittedAt || doc.createdAt;
        if (!existing || docTimestamp > existing.createdAt) {
          latestDocByControl.set(controlCode, {
            status: normalizedStatus,
            createdAt: docTimestamp,
            docType: doc.docType || null,
            originalName: doc.originalName || '',
          });
        }
      }
      if (doc.reviewedAt) reviewedDocs += 1;
      if (doc.submittedAt) submittedDocs += 1;
      if (doc.submittedAt && String(doc.matchStatus || '').toUpperCase() === 'COMPLIANT') {
        acceptedControls.add(controlCode);
      }
    }

    const resolveDocStatus = (docs: typeof documents) => {
      const statuses = docs
        .map((doc) => String(doc.matchStatus || '').toUpperCase())
        .filter(Boolean);
      if (statuses.includes('COMPLIANT')) return 'COMPLIANT';
      if (statuses.includes('PARTIAL')) return 'PARTIAL';
      if (statuses.includes('NOT_COMPLIANT')) return 'NOT_COMPLIANT';
      return 'UNKNOWN';
    };

    const distinctMatchedControls = docsByControl.size;
    const documentsPerControl = Array.from(docsByControl.entries())
      .map(([controlId, docs]) => ({
        controlId,
        count: docs.length,
      }))
      .sort((a, b) => b.count - a.count);

    let evaluatedControls = latestEvaluations.length;
    for (const control of allowedControls) {
      if (statusByControlCode.has(control.controlCode)) continue;
      const docs = docsByControl.get(control.controlCode) || [];
      const docStatus = resolveDocStatus(docs);
      if (docStatus !== 'UNKNOWN') {
        evaluatedControls += 1;
      }
      statusByControlCode.set(control.controlCode, docStatus);
      if (!lastSeenByControl.has(control.controlCode)) {
        const latestDoc = latestDocByControl.get(control.controlCode);
        if (latestDoc) {
          lastSeenByControl.set(control.controlCode, latestDoc.createdAt);
        }
      }
    }

    for (const control of allowedControls) {
      const status = statusByControlCode.get(control.controlCode) || 'UNKNOWN';
      if (statusCounts[status as keyof typeof statusCounts] !== undefined) {
        statusCounts[status as keyof typeof statusCounts] += 1;
      } else {
        statusCounts.UNKNOWN += 1;
      }
    }

    const coveragePercent = totalControls
      ? Math.round(
          ((statusCounts.COMPLIANT + statusCounts.PARTIAL * partialWeight) / totalControls) * 100,
        )
      : 0;

    const evidenceHealth: EvidenceHealth = {
      high: 0,
      medium: 0,
      low: 0,
      score: 0,
      total: totalControls,
    };

    let evidenceMissing = 0;
    for (const control of allowedControls) {
      if (!docsByControl.has(control.controlCode)) evidenceMissing += 1;
    }

    const now = Date.now();
    let evidenceExpired = 0;
    let evidenceExpiringSoon = 0;
    let evidenceOutdated = 0;
    let evidenceRejected = 0;
    for (const doc of documents) {
      const ts = (doc.reviewedAt || doc.submittedAt || doc.createdAt).getTime();
      const ageDays = Math.floor((now - ts) / 86400000);
      if (ageDays > 365) evidenceExpired += 1;
      else if (ageDays >= 335) evidenceExpiringSoon += 1;
      else if (ageDays >= 180) evidenceOutdated += 1;
      if (String(doc.matchStatus || '').toUpperCase() === 'NOT_COMPLIANT') {
        evidenceRejected += 1;
      }
    }

    let evidenceReusedAcrossFrameworks = 0;
    for (const control of allowedControls) {
      if (!docsByControl.has(control.controlCode)) continue;
      const frameworks = (control.frameworkMappings || [])
        .map((mapping) => String(mapping.framework || '').trim())
        .filter(Boolean);
      if (new Set(frameworks).size > 1) {
        evidenceReusedAcrossFrameworks += 1;
      }
    }

    for (const control of allowedControls) {
      const docs = docsByControl.get(control.controlCode) || [];
      const isGovernance = this.isGovernanceControl(control.controlCode, control.topic?.title || '');
      let level: 'high' | 'medium' | 'low' = 'low';
      for (const doc of docs) {
        const label = `${doc.docType || ''} ${doc.originalName || ''}`.trim();
        const next = this.classifyEvidenceType(label, isGovernance);
        if (next === 'high') {
          level = 'high';
          break;
        }
        if (next === 'medium') level = 'medium';
      }
      evidenceHealth[level] += 1;
    }

    evidenceHealth.score = totalControls
      ? Math.round(
          ((evidenceHealth.high + evidenceHealth.medium * partialWeight) / totalControls) * 100,
        )
      : 0;

    const evidenceHealthDetail: EvidenceHealthDetail = {
      expiringSoon: evidenceExpiringSoon,
      expired: evidenceExpired,
      missing: evidenceMissing,
      reusedAcrossFrameworks: evidenceReusedAcrossFrameworks,
      rejected: evidenceRejected,
      outdated: evidenceOutdated,
    };

    const evidenceHealthDetailV2 = {
      expiringIn30: evidenceExpiringSoon,
      expired: evidenceExpired,
      missing: evidenceMissing,
      reusedAcrossFrameworks: evidenceReusedAcrossFrameworks,
      rejected: evidenceRejected,
      outdated: evidenceOutdated,
    };

    const evidenceHealthVisual: EvidenceHealthVisual = {
      valid: 0,
      expiringSoon: 0,
      expired: 0,
      missing: 0,
      total: totalControls,
    };

    for (const control of allowedControls) {
      const latest = latestDocByControl.get(control.controlCode);
      if (!latest) {
        evidenceHealthVisual.missing += 1;
        continue;
      }
      const ageDays = Math.floor((now - latest.createdAt.getTime()) / 86400000);
      if (ageDays > 365) {
        evidenceHealthVisual.expired += 1;
      } else if (ageDays >= 335) {
        evidenceHealthVisual.expiringSoon += 1;
      } else {
        evidenceHealthVisual.valid += 1;
      }
    }

    const submissionReadiness: SubmissionReadiness = {
      reviewed: reviewedDocs,
      submitted: submittedDocs,
      percent: reviewedDocs ? Math.round((submittedDocs / reviewedDocs) * 100) : 0,
    };

    const evidenceMappings: Array<{
      controlId: string;
      evidenceRequest: { artifact: string | null; description: string | null } | null;
    }> = [];
    if (allowedControlIds.length) {
      for (const chunk of this.chunk(allowedControlIds)) {
        const rows = await this.prisma.controlEvidenceMapping.findMany({
          where: { controlId: { in: chunk } },
          include: { evidenceRequest: { select: { artifact: true, description: true } } },
        });
        evidenceMappings.push(...rows);
      }
    }

    const policyRequiredByControlCode = new Map<string, boolean>();
    for (const mapping of evidenceMappings) {
      const controlCode = controlIdToCode.get(mapping.controlId);
      if (!controlCode) continue;
      const text = `${mapping.evidenceRequest?.artifact || ''} ${mapping.evidenceRequest?.description || ''}`
        .toLowerCase();
      if (!text) continue;
      if (text.includes('policy')) {
        policyRequiredByControlCode.set(controlCode, true);
      }
    }

    let missingPolicies = 0;
    let missingLogs = 0;
    for (const mapping of evidenceMappings) {
      const controlCode = controlIdToCode.get(mapping.controlId);
      if (!controlCode) continue;
      if (acceptedControls.has(controlCode)) continue;

      const text = `${mapping.evidenceRequest?.artifact || ''} ${
        mapping.evidenceRequest?.description || ''
      }`.toLowerCase();
      if (!text) continue;
      if (text.includes('policy')) missingPolicies += 1;
      if (text.includes('log') || text.includes('record') || text.includes('ticket')) missingLogs += 1;
    }

    const auditReadiness: AuditReadiness = {
      acceptedControls: acceptedControls.size,
      totalControls,
      percent: totalControls ? Math.round((acceptedControls.size / totalControls) * 100) : 0,
      missingPolicies,
      missingLogs,
    };

    const complianceBreakdown: ComplianceBreakdown = {
      compliant: statusCounts.COMPLIANT,
      partial: statusCounts.PARTIAL,
      notCompliant: statusCounts.NOT_COMPLIANT,
      unknown: statusCounts.UNKNOWN,
      total: totalControls,
      compliantPct: totalControls ? Math.round((statusCounts.COMPLIANT / totalControls) * 100) : 0,
      partialPct: totalControls ? Math.round((statusCounts.PARTIAL / totalControls) * 100) : 0,
      notCompliantPct: totalControls ? Math.round((statusCounts.NOT_COMPLIANT / totalControls) * 100) : 0,
      unknownPct: totalControls ? Math.round((statusCounts.UNKNOWN / totalControls) * 100) : 0,
    };

    const gapLabels: Record<ComplianceGapItem['id'], string> = {
      'missing-evidence': 'Missing Evidence',
      'control-not-implemented': 'Control Not Implemented',
      'control-not-tested': 'Control Not Tested',
      'owner-not-assigned': 'Owner Not Assigned',
      'outdated-policy': 'Outdated Policy',
    };

    const complianceGapCounts = new Map<ComplianceGapItem['id'], number>();
    const resolveGapForControl = (control: (typeof allowedControls)[number]) => {
      const status = (statusByControlCode.get(control.controlCode) || 'UNKNOWN').toUpperCase();
      if (status === 'COMPLIANT') return null;

      const docs = docsByControl.get(control.controlCode) || [];
      const ownerRole = String(control.ownerRole || '').trim();
      const latestDoc = latestDocByControl.get(control.controlCode);
      const hasEvaluation = latestByControl.has(control.controlCode);
      const policyRequired = policyRequiredByControlCode.get(control.controlCode) || false;
      const policyDocName = `${latestDoc?.docType || ''} ${latestDoc?.originalName || ''}`.toLowerCase();
      const isPolicyDoc = policyDocName.includes('policy');
      const ageDays = latestDoc
        ? Math.floor((now - latestDoc.createdAt.getTime()) / 86400000)
        : null;

      if (!docs.length) return 'missing-evidence' as const;
      if (!ownerRole) return 'owner-not-assigned' as const;
      if ((policyRequired || isPolicyDoc) && ageDays !== null && ageDays >= 180) {
        return 'outdated-policy' as const;
      }
      if (!hasEvaluation || status === 'UNKNOWN') return 'control-not-tested' as const;
      return 'control-not-implemented' as const;
    };

    for (const control of allowedControls) {
      const gap = resolveGapForControl(control);
      if (!gap) continue;
      complianceGapCounts.set(gap, (complianceGapCounts.get(gap) || 0) + 1);
    }

    const complianceGaps: ComplianceGapItem[] = Array.from(complianceGapCounts.entries())
      .map(([id, count]) => ({
        id,
        label: gapLabels[id],
        count,
        route: '/control-kb',
        query: { status: 'enabled', gap: id },
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const riskDriverLabels: Record<
      'missing-evidence' | 'owner-not-assigned' | 'control-not-tested',
      string
    > = {
      'missing-evidence': 'Missing Evidence',
      'owner-not-assigned': 'Unassigned Owners',
      'control-not-tested': 'Unreviewed Controls',
    };

    const resolveRiskDriver = (control: (typeof allowedControls)[number]) => {
      const status = (statusByControlCode.get(control.controlCode) || 'UNKNOWN').toUpperCase();
      if (status === 'COMPLIANT') return null;

      const docs = docsByControl.get(control.controlCode) || [];
      const ownerRole = String(control.ownerRole || '').trim();
      const hasEvaluation = latestByControl.has(control.controlCode);

      if (!docs.length) return 'missing-evidence' as const;
      if (!ownerRole) return 'owner-not-assigned' as const;
      if (!hasEvaluation) return 'control-not-tested' as const;
      return 'missing-evidence' as const;
    };

    const riskDriverCounts = new Map<
      'missing-evidence' | 'owner-not-assigned' | 'control-not-tested',
      number
    >();
    for (const control of allowedControls) {
      const driver = resolveRiskDriver(control);
      if (!driver) continue;
      riskDriverCounts.set(driver, (riskDriverCounts.get(driver) || 0) + 1);
    }

    const riskDrivers: RiskDriver[] = Array.from(riskDriverCounts.entries())
      .map(([id, count]) => ({
        id,
        label: riskDriverLabels[id],
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    const impactLabels = ['Low', 'Medium', 'High'];
    const likelihoodLabels = ['Low', 'Medium', 'High'];
    const heatmapMatrix = this.buildHeatmapMatrix();
    for (const control of allowedControls) {
      const status = statusByControlCode.get(control.controlCode) || 'UNKNOWN';
      const impact = this.resolveImpactLevel(status);
      const likelihood = this.resolveLikelihoodLevel(lastSeenByControl.get(control.controlCode) || null);
      heatmapMatrix[impact - 1][likelihood - 1] += 1;
    }
    const riskHeatmap: RiskHeatmap = {
      impactLabels,
      likelihoodLabels,
      matrix: heatmapMatrix,
    };

    const riskHeatmapControls = allowedControls.map((control) => {
      const status = statusByControlCode.get(control.controlCode) || 'UNKNOWN';
      const impactIndex = this.resolveImpactLevel(status);
      const likelihoodIndex = this.resolveLikelihoodLevel(lastSeenByControl.get(control.controlCode) || null);
      const driverId = resolveRiskDriver(control);
      return {
        controlCode: control.controlCode,
        controlDbId: control.id,
        title: control.title || control.controlCode,
        status,
        impact: impactLabels[impactIndex - 1] || 'Low',
        likelihood: likelihoodLabels[likelihoodIndex - 1] || 'Low',
        driverId: driverId || null,
      };
    });

    const riskDistribution: RiskDistribution = {
      high: 0,
      medium: 0,
      low: 0,
      total: 0,
      exposure: 'low',
    };

    for (let r = 0; r < heatmapMatrix.length; r += 1) {
      for (let c = 0; c < heatmapMatrix[r].length; c += 1) {
        const value = heatmapMatrix[r][c];
        if (!value) continue;
        riskDistribution.total += value;
        const score = (r + 1) + (c + 1);
        if (score >= 5) riskDistribution.high += value;
        else if (score >= 4) riskDistribution.medium += value;
        else riskDistribution.low += value;
      }
    }

    if (riskDistribution.high > 0) riskDistribution.exposure = 'high';
    else if (riskDistribution.medium > 0) riskDistribution.exposure = 'medium';

    const controlIdToStatus = new Map<string, string>();
    for (const control of allowedControls) {
      controlIdToStatus.set(control.id, statusByControlCode.get(control.controlCode) || 'UNKNOWN');
    }

    const riskMappings: Array<{
      controlId: string;
      risk: { id: string; title: string | null } | null;
    }> = [];
    if (allowedControlIds.length) {
      for (const chunk of this.chunk(allowedControlIds)) {
        const rows = await this.prisma.controlRiskMapping.findMany({
          where: { controlId: { in: chunk } },
          include: { risk: { select: { id: true, title: true } } },
        });
        riskMappings.push(...rows);
      }
    }

    const riskBucket = new Map<string, { title: string; controlIds: Set<string> }>();
    for (const mapping of riskMappings) {
      if (!mapping.risk) continue;
      const entry = riskBucket.get(mapping.risk.id) || {
        title: mapping.risk.title || mapping.risk.id,
        controlIds: new Set<string>(),
      };
      entry.controlIds.add(mapping.controlId);
      riskBucket.set(mapping.risk.id, entry);
    }

    const riskCoverage: RiskCoverage[] = Array.from(riskBucket.entries())
      .map(([id, entry]) => {
        const controlIds = Array.from(entry.controlIds);
        const scores = controlIds.map((controlId) => {
          const status = controlIdToStatus.get(controlId) || 'UNKNOWN';
          if (status === 'COMPLIANT') return 1;
          if (status === 'PARTIAL') return partialWeight;
          return 0;
        });
        const total = scores.length;
        const sum = scores.reduce((acc, score) => acc + score, 0);
        const coveragePercent = total ? Math.round((sum / total) * 100) : 0;
        const missingCount = scores.filter((score) => score < 1).length;
        const controlCodes = controlIds
          .map((controlId) => controlIdToCode.get(controlId))
          .filter((value): value is string => Boolean(value))
          .sort();
        return {
          id,
          title: entry.title,
          coveragePercent,
          controlCount: total,
          missingCount,
          controlCodes,
        };
      })
      .sort((a, b) => a.coveragePercent - b.coveragePercent)
      .slice(0, 8);

    const riskControls: RiskControl[] = latestEvaluations
      .filter((evaluation) => {
        const status = String(evaluation.status || '').toUpperCase();
        return status === 'PARTIAL' || status === 'NOT_COMPLIANT';
      })
      .sort((a, b) => {
        const score = (status: string) => (status === 'NOT_COMPLIANT' ? 2 : 1);
        return score(String(b.status)) - score(String(a.status));
      })
      .slice(0, 6)
      .map((evaluation) => ({
        controlId: evaluation.controlId,
        controlDbId: controlCodeToId.get(String(evaluation.controlId)) || null,
        title: controlCodeToTitle.get(String(evaluation.controlId)) || null,
        status: String(evaluation.status || 'UNKNOWN').toUpperCase(),
        summary: evaluation.summary || 'Evidence gap detected.',
        updatedAt: evaluation.createdAt.toISOString(),
      }));

    const recentDocs = documents
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 6);

    const recentEvalActivity = latestEvaluations.slice(0, 6).map((evaluation) => ({
      label: `${evaluation.controlId} reviewed`,
      detail: `Status: ${String(evaluation.status || 'UNKNOWN').toUpperCase()}`,
      time: evaluation.createdAt.toISOString(),
    }));

    const recentDocActivity = recentDocs.map((doc) => ({
      label: `${doc.originalName} uploaded`,
      detail: doc.conversation?.title ? `Chat: ${doc.conversation.title}` : 'Chat upload',
      time: doc.createdAt.toISOString(),
    }));

    const activity: ActivityItem[] = [...recentDocActivity, ...recentEvalActivity]
      .sort((a, b) => (a.time < b.time ? 1 : -1))
      .slice(0, 8);

    const overdueThreshold = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const overdueEvidence = documents.filter(
      (doc) => !doc.reviewedAt && doc.createdAt.getTime() < overdueThreshold,
    ).length;

    const frameworkNames = frameworkScope
      ? [frameworkScope]
      : (await this.prisma.framework.findMany({
          where: { status: 'enabled' },
          select: { name: true },
        }))
          .map((fw) => fw.name)
          .filter(Boolean);

    const controlsByFramework = new Map<string, string[]>();
    for (const control of allowedControls) {
      for (const mapping of control.frameworkMappings || []) {
        const fw = String(mapping.framework || '').trim();
        if (!fw) continue;
        const list = controlsByFramework.get(fw) || [];
        list.push(control.controlCode);
        controlsByFramework.set(fw, list);
      }
    }

    const evaluationsByControl = new Map<string, Array<{ createdAt: Date; status: string }>>();
    for (const evaluation of evaluations) {
      const code = String(evaluation.controlId || '').trim();
      if (!code) continue;
      const list = evaluationsByControl.get(code) || [];
      list.push({ createdAt: evaluation.createdAt, status: String(evaluation.status || 'UNKNOWN').toUpperCase() });
      evaluationsByControl.set(code, list);
    }
    for (const list of evaluationsByControl.values()) {
      list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    const documentsByControl = new Map<string, Array<{ createdAt: Date; status: string }>>();
    for (const doc of documents) {
      const code = String(doc.matchControlId || '').trim();
      if (!code) continue;
      const status = String(doc.matchStatus || '').toUpperCase();
      if (!status) continue;
      const list = documentsByControl.get(code) || [];
      list.push({ createdAt: doc.createdAt, status });
      documentsByControl.set(code, list);
    }
    for (const list of documentsByControl.values()) {
      list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    const eventByControl = new Map<string, Array<{ createdAt: Date; status: string }>>();
    for (const code of allowedControlCodes) {
      const evalEvents = evaluationsByControl.get(code);
      if (evalEvents && evalEvents.length) {
        eventByControl.set(code, evalEvents);
        continue;
      }
      const docEvents = documentsByControl.get(code) || [];
      if (docEvents.length) {
        eventByControl.set(code, docEvents);
      }
    }

    const months = this.buildMonthSeries(6);
    const frameworkProgress: FrameworkProgress[] = frameworkNames.map((framework) => {
      const controlCodes = controlsByFramework.get(framework) || [];
      const series = months.map((month) => {
        return this.computeCompliancePercentAt(
          controlCodes,
          eventByControl,
          month.end,
          partialWeight,
        );
      });
      return { framework, series };
    });

    const controlCodesForTrends = allowedControlCodes;
    const complianceTrend = months.map((month) =>
      this.computeCompliancePercentAt(controlCodesForTrends, eventByControl, month.end, partialWeight),
    );
    const riskScoreTrend = complianceTrend.map((value) => Math.max(0, 100 - value));
    const mttrTrend = months.map((month) =>
      this.computeMttrAt(controlCodesForTrends, eventByControl, month.end),
    );
    const trendsV2 = this.buildTrendsV2({
      rangeDays,
      controlCodes: controlCodesForTrends,
      eventByControl,
      partialWeight,
    });

    const comparisonTargets = ['ISO 27001', 'SOC 2', 'NIST'];
    const frameworkComparison: FrameworkComparison[] = comparisonTargets.map((target) => {
      const candidates = allowedControls.filter((control) =>
        (control.frameworkMappings || []).some((mapping) =>
          String(mapping.framework || '').toLowerCase().includes(target.toLowerCase()),
        ),
      );
      const controlCodes = candidates.map((control) => control.controlCode);
      const completion = this.computeCompliancePercentAt(
        controlCodes,
        eventByControl,
        months[months.length - 1].end,
        partialWeight,
      );
      const failedControls = controlCodes.filter(
        (code) => (statusByControlCode.get(code) || 'UNKNOWN') === 'NOT_COMPLIANT',
      ).length;
      return {
        framework: target,
        completionPercent: completion,
        failedControls,
      };
    });

    const frameworkComparisonV2: FrameworkComparisonV2[] = comparisonTargets.map((target) => {
      const candidates = allowedControls.filter((control) =>
        (control.frameworkMappings || []).some((mapping) =>
          String(mapping.framework || '').toLowerCase().includes(target.toLowerCase()),
        ),
      );
      const controlCodes = candidates.map((control) => control.controlCode);
      const total = controlCodes.length;
      let compliant = 0;
      let partial = 0;
      let notCompliant = 0;
      for (const code of controlCodes) {
        const status = (statusByControlCode.get(code) || 'UNKNOWN').toUpperCase();
        if (status === 'COMPLIANT') compliant += 1;
        else if (status === 'PARTIAL') partial += 1;
        else if (status === 'NOT_COMPLIANT') notCompliant += 1;
      }
      const unknown = Math.max(0, total - compliant - partial - notCompliant);
      const completionPercent = total
        ? Math.round(((compliant + partial * partialWeight) / total) * 100)
        : 0;
      return {
        framework: target,
        totalControls: total,
        compliant,
        partial,
        notCompliant,
        unknown,
        completionPercent,
        failedControls: notCompliant,
      };
    });

    const uploadSummary: UploadSummary = {
      totalUploadedDocuments: totalDocuments,
      distinctMatchedControls,
      documentsPerControl: documentsPerControl.slice(0, 8),
    };

    const failedControlCodes = allowedControls
      .filter((control) => (statusByControlCode.get(control.controlCode) || 'UNKNOWN') === 'NOT_COMPLIANT')
      .map((control) => control.controlCode);
    const failedControls = failedControlCodes.length;

    const overdueControlCodes = allowedControls
      .filter((control) => {
        const status = statusByControlCode.get(control.controlCode) || 'UNKNOWN';
        if (status === 'COMPLIANT') return false;
        const lastSeen = lastSeenByControl.get(control.controlCode);
        if (!lastSeen) return true;
        return (Date.now() - lastSeen.getTime()) / 86400000 > 30;
      })
      .map((control) => control.controlCode);

    const controlsNeedingAttention = new Set([...failedControlCodes, ...overdueControlCodes]);
    const overdueControls = overdueControlCodes.length;
    const risksWithoutMitigation = riskCoverage.filter((risk) => risk.coveragePercent === 0).length;
    const evidenceIssues = evidenceMissing + evidenceExpired;

    const auditSummary: AuditSummary = {
      upcoming14: 0,
      upcoming30: 0,
      upcoming90: 0,
      upcoming: [],
    };
    const upcomingAudits = auditSummary.upcoming30;

    const attentionToday: AttentionTodayItem[] = [
      {
        id: 'failed-controls',
        label: 'Failed Controls',
        count: failedControls,
        severity: failedControls ? 'high' : 'low',
        kind: 'control',
        route: '/control-kb',
        query: { status: 'enabled' },
      },
      {
        id: 'missing-evidence',
        label: 'Missing Evidence',
        count: evidenceMissing,
        severity: evidenceMissing ? 'high' : 'low',
        kind: 'evidence',
        route: '/uploads',
      },
      {
        id: 'risks-without-owner',
        label: 'Risks Without Owner',
        count: risksWithoutMitigation,
        severity: risksWithoutMitigation ? 'medium' : 'low',
        kind: 'risk',
        route: '/dashboard',
      },
      {
        id: 'upcoming-audits',
        label: 'Upcoming Audits',
        count: auditSummary.upcoming30,
        severity: auditSummary.upcoming30 ? 'medium' : 'low',
        kind: 'audit',
        route: '/dashboard',
        query: { range: '30' },
      },
    ];

    const attentionItems: AttentionItem[] = [
      {
        id: 'failed-controls',
        label: 'Controls failed',
        count: failedControls,
        severity: 'high',
        route: '/control-kb',
        query: { status: 'enabled' },
      },
      {
        id: 'overdue-controls',
        label: 'Overdue controls',
        count: overdueControls,
        severity: 'medium',
        route: '/control-kb',
        query: { status: 'enabled' },
      },
      {
        id: 'risks-without-mitigation',
        label: 'Risks without mitigation',
        count: risksWithoutMitigation,
        severity: 'medium',
        route: '/dashboard',
      },
      {
        id: 'evidence-issues',
        label: 'Evidence missing/expired',
        count: evidenceIssues,
        severity: 'high',
        route: '/uploads',
      },
      {
        id: 'upcoming-audits',
        label: 'Audits in next 30 days',
        count: upcomingAudits,
        severity: 'low',
        route: '/dashboard',
      },
    ];

    const recommendedActions: RecommendedAction[] = [];
    if (failedControls) {
      recommendedActions.push({
        id: 'add-evidence',
        title: 'Add evidence for failed controls',
        reason: `${failedControls} controls are marked NOT_COMPLIANT`,
        route: '/uploads',
        severity: 'high',
      });
    }
    if (evidenceMissing) {
      recommendedActions.push({
        id: 'upload-missing-evidence',
        title: 'Upload missing evidence',
        reason: `${evidenceMissing} controls have no evidence yet`,
        route: '/uploads',
        severity: 'medium',
      });
    }
    if (risksWithoutMitigation) {
      recommendedActions.push({
        id: 'mitigate-risks',
        title: 'Mitigate uncovered risks',
        reason: `${risksWithoutMitigation} risks have 0% coverage`,
        route: '/dashboard',
        severity: 'medium',
      });
    }

    const recommendedActionsV2: RecommendedActionV2[] = [];
    if (failedControlCodes.length) {
      recommendedActionsV2.push({
        id: 'add-evidence-control',
        title: `Add evidence for ${failedControlCodes[0]}`,
        reason: `${failedControls} controls are marked NOT_COMPLIANT`,
        route: '/control-kb',
        query: { status: 'enabled' },
        severity: 'high',
        cta: 'Review control',
      });
    }
    if (overdueControls) {
      recommendedActionsV2.push({
        id: 'review-overdue-controls',
        title: 'Review overdue controls',
        reason: `${overdueControls} controls have not been updated in 30+ days`,
        route: '/control-kb',
        query: { status: 'enabled' },
        severity: 'medium',
        cta: 'Open controls',
      });
    }
    if (evidenceIssues) {
      recommendedActionsV2.push({
        id: 'refresh-evidence',
        title: 'Refresh evidence for expiring items',
        reason: `${evidenceIssues} evidence items are missing or expired`,
        route: '/uploads',
        severity: 'high',
        cta: 'Review evidence',
      });
    }
    if (risksWithoutMitigation) {
      recommendedActionsV2.push({
        id: 'mitigate-risks',
        title: 'Assign mitigation owners for top risks',
        reason: `${risksWithoutMitigation} risks show 0% coverage`,
        route: '/dashboard',
        severity: 'medium',
        cta: 'View risks',
      });
    }

    const openRisks = riskControls.length;

    const kpis: DashboardKpi[] = [
      {
        id: 'coverage',
        label: 'Overall Coverage',
        value: `${coveragePercent}%`,
        note: `${statusCounts.COMPLIANT + statusCounts.PARTIAL}/${evaluatedControls} controls reviewed`,
        severity: coveragePercent < 60 ? 'high' : coveragePercent < 80 ? 'medium' : 'low',
        drilldown: { route: '/control-kb', query: { status: 'enabled' } },
      },
      {
        id: 'evidence-health',
        label: 'Evidence Health Score',
        value: `${evidenceHealth.score}%`,
        note: `High ${evidenceHealth.high} · Medium ${evidenceHealth.medium} · Low ${evidenceHealth.low}`,
        severity: evidenceHealth.score < 60 ? 'high' : evidenceHealth.score < 80 ? 'medium' : 'low',
        drilldown: { route: '/uploads' },
      },
      {
        id: 'audit-readiness',
        label: 'Audit Readiness',
        value: `${auditReadiness.percent}%`,
        note: `Missing policies ${auditReadiness.missingPolicies} · Missing logs ${auditReadiness.missingLogs}`,
        severity: auditReadiness.percent < 60 ? 'high' : auditReadiness.percent < 80 ? 'medium' : 'low',
        drilldown: { route: '/uploads' },
      },
      {
        id: 'submission-readiness',
        label: 'Submission Readiness',
        value: `${submissionReadiness.percent}%`,
        note: `${submissionReadiness.submitted}/${submissionReadiness.reviewed} submitted`,
        severity: submissionReadiness.percent < 60 ? 'high' : submissionReadiness.percent < 80 ? 'medium' : 'low',
        drilldown: { route: '/uploads' },
      },
      {
        id: 'overdue-evidence',
        label: 'Overdue Evidence',
        value: `${overdueEvidence}`,
        note: 'Awaiting review >14 days',
        severity: overdueEvidence ? 'high' : 'low',
        drilldown: { route: '/uploads' },
      },
      {
        id: 'open-risks',
        label: 'Open Risks',
        value: `${openRisks}`,
        note: 'Partial or missing controls',
        severity: openRisks ? 'medium' : 'low',
        drilldown: { route: '/dashboard' },
      },
      {
        id: 'documents-uploaded',
        label: 'Documents Uploaded',
        value: `${uploadSummary.totalUploadedDocuments}`,
        note: 'Total evidence files',
        severity: 'low',
        drilldown: { route: '/uploads' },
      },
      {
        id: 'matched-controls',
        label: 'Matched Controls',
        value: `${uploadSummary.distinctMatchedControls}`,
        note: 'Distinct controls with uploads',
        severity: 'low',
        drilldown: { route: '/control-kb', query: { compliance: 'COMPLIANT' } },
      },
    ];

    const executiveSummary: ExecutiveSummary = {
      headline: `${coveragePercent}% coverage across ${totalControls} controls`,
      highlights: [
        `${statusCounts.COMPLIANT} compliant · ${statusCounts.PARTIAL} partial · ${statusCounts.NOT_COMPLIANT} failed`,
        `Evidence health ${evidenceHealth.score}%`,
        `Audit readiness ${auditReadiness.percent}%`,
      ],
      risks: [
        failedControls ? `${failedControls} failed controls require attention` : 'No failed controls detected',
        evidenceMissing ? `${evidenceMissing} controls are missing evidence` : 'No missing evidence detected',
        risksWithoutMitigation ? `${risksWithoutMitigation} risks have 0% coverage` : 'No uncovered risks detected',
      ],
      lastUpdated: new Date().toISOString(),
    };

    return {
      ok: true,
      appliedFilters: {
        framework: frameworkScope || null,
        businessUnit: filters?.businessUnit || null,
        riskCategory: filters?.riskCategory || null,
        rangeDays,
      },
      filterOptions,
      attentionToday,
      attentionItems,
      evidenceHealthDetail,
      evidenceHealthDetailV2,
      trends: {
        riskScore: riskScoreTrend,
        compliance: complianceTrend,
        mttr: mttrTrend,
      },
      trendsV2,
      frameworkComparison,
      frameworkComparisonV2,
      recommendedActions,
      recommendedActionsV2,
      auditSummary,
      kpis,
      executiveSummary,
      complianceGaps,
      metrics: {
        coveragePercent,
        evaluatedControls,
        compliant: statusCounts.COMPLIANT,
        partial: statusCounts.PARTIAL,
        missing: statusCounts.NOT_COMPLIANT,
        unknown: statusCounts.UNKNOWN,
        evidenceItems: totalDocuments,
        awaitingReview,
        openRisks,
        overdueEvidence,
        lastReviewAt: lastReviewAt ? lastReviewAt.toISOString() : null,
        evidenceHealth,
        auditReadiness,
        submissionReadiness,
      },
      uploadSummary,
      complianceBreakdown,
      riskDrivers,
      riskHeatmap,
      riskHeatmapControls,
      riskDistribution,
      evidenceHealthVisual,
      frameworkProgress,
      months: months.map((month) => month.label),
      riskCoverage,
      riskControls,
      activity,
    };
  }
}
