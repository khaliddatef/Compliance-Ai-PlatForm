import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type RiskControl = {
  controlId: string;
  status: string;
  summary: string;
  updatedAt: string;
};

type ActivityItem = {
  label: string;
  detail: string;
  time: string;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(standard?: string) {
    const standardKey = (standard || 'ISO').toUpperCase();

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

    const latestEvaluations = Array.from(latestByControl.values());
    const statusCounts = {
      COMPLIANT: 0,
      PARTIAL: 0,
      NOT_COMPLIANT: 0,
      UNKNOWN: 0,
    };

    latestEvaluations.forEach((evaluation) => {
      const status = String(evaluation.status || '').toUpperCase();
      if (statusCounts[status as keyof typeof statusCounts] !== undefined) {
        statusCounts[status as keyof typeof statusCounts] += 1;
      } else {
        statusCounts.UNKNOWN += 1;
      }
    });

    const evaluatedControls = latestEvaluations.length;
    const coveragePercent = evaluatedControls
      ? Math.round(((statusCounts.COMPLIANT + statusCounts.PARTIAL) / evaluatedControls) * 100)
      : 0;

    const [totalDocuments, awaitingReview] = await Promise.all([
      this.prisma.document.count({ where: { standard: standardKey } }),
      this.prisma.document.count({ where: { standard: standardKey, reviewedAt: null } }),
    ]);

    const lastReviewAt = evaluations[0]?.createdAt ?? null;

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
      },
      riskControls,
      activity,
    };
  }
}
