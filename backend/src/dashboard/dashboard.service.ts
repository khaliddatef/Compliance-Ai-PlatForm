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

  async getDashboard() {
    const activeFramework = await this.prisma.framework.findFirst({
      where: { status: 'enabled' },
      orderBy: { updatedAt: 'desc' },
      select: { name: true },
    });

    const activeFrameworkName = String(activeFramework?.name || '').trim();

    const controls = await this.prisma.controlDefinition.findMany({
      where: {
        status: 'enabled',
        ...(activeFrameworkName
          ? { frameworkMappings: { some: { framework: activeFrameworkName } } }
          : {}),
      },
      select: {
        id: true,
        controlCode: true,
        title: true,
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
    const latestDocByControl = new Map<string, { status: string; createdAt: Date }>();
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
        if (!existing || doc.createdAt > existing.createdAt) {
          latestDocByControl.set(controlCode, { status: normalizedStatus, createdAt: doc.createdAt });
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

    const frameworkNames = activeFrameworkName
      ? [activeFrameworkName]
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
        if (!controlCodes.length) return 0;
        let sum = 0;
        for (const code of controlCodes) {
          const events = eventByControl.get(code) || [];
          const match = events.find((item) => item.createdAt.getTime() <= month.end.getTime());
          const status = match?.status || 'UNKNOWN';
          if (status === 'COMPLIANT') sum += 1;
          else if (status === 'PARTIAL') sum += partialWeight;
        }
        return Math.round((sum / controlCodes.length) * 100);
      });
      return { framework, series };
    });

    const uploadSummary: UploadSummary = {
      totalUploadedDocuments: totalDocuments,
      distinctMatchedControls,
      documentsPerControl: documentsPerControl.slice(0, 8),
    };

    const openRisks = riskControls.length;

    return {
      ok: true,
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
      riskHeatmap,
      frameworkProgress,
      months: months.map((month) => month.label),
      riskCoverage,
      riskControls,
      activity,
    };
  }
}
