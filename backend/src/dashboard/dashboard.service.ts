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

type RiskCoverage = {
  id: string;
  title: string;
  coveragePercent: number;
  controlCount: number;
  missingCount: number;
  controlCodes: string[];
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

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

  async getDashboard(standard?: string) {
    const standardKey = (standard || 'ISO').toUpperCase();
    const activeFrameworks = await this.getActiveFrameworkSet(standardKey);

    const controls = await this.prisma.controlDefinition.findMany({
      where: { topic: { standard: standardKey } },
      select: {
        id: true,
        controlCode: true,
        title: true,
        topic: { select: { title: true } },
        frameworkMappings: { select: { framework: true } },
      },
    });

    const allowedControls = activeFrameworks
      ? controls.filter((control) => this.isControlAllowed(control, activeFrameworks))
      : controls;

    const allowedControlCodes = allowedControls.map((control) => control.controlCode);
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
      where: { standard: standardKey },
      orderBy: { createdAt: 'desc' },
    });

    const latestByControl = new Map<string, (typeof evaluations)[number]>();
    for (const evaluation of evaluations) {
      if (!latestByControl.has(evaluation.controlId)) {
        latestByControl.set(evaluation.controlId, evaluation);
      }
    }

    const latestEvaluations = Array.from(latestByControl.values()).filter((evaluation) =>
      allowedControlCodes.includes(String(evaluation.controlId)),
    );
    const statusCounts = {
      COMPLIANT: 0,
      PARTIAL: 0,
      NOT_COMPLIANT: 0,
      UNKNOWN: 0,
    };

    const statusByControlCode = new Map<string, string>();
    for (const evaluation of latestEvaluations) {
      const controlCode = String(evaluation.controlId);
      const status = String(evaluation.status || '').toUpperCase();
      statusByControlCode.set(controlCode, status);
    }

    for (const control of allowedControls) {
      const status = statusByControlCode.get(control.controlCode) || 'UNKNOWN';
      if (statusCounts[status as keyof typeof statusCounts] !== undefined) {
        statusCounts[status as keyof typeof statusCounts] += 1;
      } else {
        statusCounts.UNKNOWN += 1;
      }
    }

    const totalControls = allowedControls.length;
    const evaluatedControls = latestEvaluations.length;
    const partialWeight = 0.6;
    const coveragePercent = totalControls
      ? Math.round(
          ((statusCounts.COMPLIANT + statusCounts.PARTIAL * partialWeight) / totalControls) * 100,
        )
      : 0;

    const [totalDocuments, awaitingReview, documents] = await Promise.all([
      this.prisma.document.count({ where: { standard: standardKey } }),
      this.prisma.document.count({ where: { standard: standardKey, reviewedAt: null } }),
      allowedControlCodes.length
        ? this.prisma.document.findMany({
            where: { standard: standardKey, matchControlId: { in: allowedControlCodes } },
            select: {
              matchControlId: true,
              docType: true,
              originalName: true,
              matchStatus: true,
              reviewedAt: true,
              submittedAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const lastReviewAt = evaluations[0]?.createdAt ?? null;

    const docsByControl = new Map<string, typeof documents>();
    const acceptedControls = new Set<string>();
    let reviewedDocs = 0;
    let submittedDocs = 0;
    for (const doc of documents) {
      const controlCode = String(doc.matchControlId || '');
      if (!controlCode) continue;
      const list = docsByControl.get(controlCode) || [];
      list.push(doc);
      docsByControl.set(controlCode, list);
      if (doc.reviewedAt) reviewedDocs += 1;
      if (doc.submittedAt) submittedDocs += 1;
      if (doc.submittedAt && String(doc.matchStatus || '').toUpperCase() === 'COMPLIANT') {
        acceptedControls.add(controlCode);
      }
    }

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

    const evidenceMappings = allowedControlIds.length
      ? await this.prisma.controlEvidenceMapping.findMany({
          where: { controlId: { in: allowedControlIds } },
          include: { evidenceRequest: { select: { artifact: true, description: true } } },
        })
      : [];

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

    const controlIdToStatus = new Map<string, string>();
    for (const control of allowedControls) {
      controlIdToStatus.set(control.id, statusByControlCode.get(control.controlCode) || 'UNKNOWN');
    }

    const riskMappings = allowedControlIds.length
      ? await this.prisma.controlRiskMapping.findMany({
          where: { controlId: { in: allowedControlIds } },
          include: { risk: { select: { id: true, title: true } } },
        })
      : [];

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

    const recentDocs = await this.prisma.document.findMany({
      where: { standard: standardKey },
      include: { conversation: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });

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

    return {
      ok: true,
      standard: standardKey,
      metrics: {
        coveragePercent,
        evaluatedControls,
        compliant: statusCounts.COMPLIANT,
        partial: statusCounts.PARTIAL,
        missing: statusCounts.NOT_COMPLIANT,
        unknown: statusCounts.UNKNOWN,
        evidenceItems: totalDocuments,
        awaitingReview,
        lastReviewAt: lastReviewAt ? lastReviewAt.toISOString() : null,
        evidenceHealth,
        auditReadiness,
        submissionReadiness,
      },
      riskCoverage,
      riskControls,
      activity,
    };
  }
}
