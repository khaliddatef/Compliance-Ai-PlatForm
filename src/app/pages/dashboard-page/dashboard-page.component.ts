import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { RouterModule } from '@angular/router';
import { ApiService, DashboardResponse } from '../../services/api.service';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.css'
})
export class DashboardPageComponent implements OnInit {
  stats: { label: string; value: string; note: string }[] = [];
  complianceBreakdown = {
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
  donutStyle = '';
  riskHeatmap: number[][] = [];
  impactLabels: string[] = [];
  likelihoodLabels: string[] = [];
  frameworkProgress: { framework: string; series: number[]; color: string }[] = [];
  frameworkMonths: string[] = [];
  riskRows: {
    control: string;
    owner: string;
    status: string;
    due: string;
    controlDbId?: string | null;
    title?: string | null;
  }[] = [];
  riskCoverageRows: {
    id: string;
    title: string;
    coverage: string;
    controlCount: number;
    controlCodes: string[];
  }[] = [];
  activityRows: { item: string; by: string; time: string }[] = [];
  evidenceHealth = { high: 0, medium: 0, low: 0, score: 0, total: 0 };
  auditReadiness = { percent: 0, acceptedControls: 0, totalControls: 0, missingPolicies: 0, missingLogs: 0 };
  submissionReadiness = { percent: 0, submitted: 0, reviewed: 0 };
  loading = true;
  error = '';
  riskPopoverId: string | null = null;

  constructor(
    private readonly api: ApiService,
    private readonly cdr: ChangeDetectorRef,
    private readonly router: Router,
  ) {}

  ngOnInit() {
    this.refresh();
  }

  refresh() {
    this.loading = true;
    this.error = '';
    this.riskPopoverId = null;
    this.cdr.markForCheck();

    this.api.getDashboard().subscribe({
      next: (res: DashboardResponse) => {
        const metrics = res?.metrics;
        const coverage = metrics?.coveragePercent ?? 0;
        const evaluated = metrics?.evaluatedControls ?? 0;
        const compliant = metrics?.compliant ?? 0;
        const partial = metrics?.partial ?? 0;
        const openRisks = metrics?.openRisks ?? 0;
        const overdueEvidence = metrics?.overdueEvidence ?? 0;

        this.evidenceHealth = metrics?.evidenceHealth || this.evidenceHealth;
        this.auditReadiness = metrics?.auditReadiness || this.auditReadiness;
        this.submissionReadiness = metrics?.submissionReadiness || this.submissionReadiness;

        this.stats = [
          {
            label: 'Overall Coverage',
            value: `${coverage}%`,
            note: `${compliant + partial}/${evaluated} controls reviewed`,
          },
          {
            label: 'Evidence Health Score',
            value: `${this.evidenceHealth.score}%`,
            note: `High ${this.evidenceHealth.high} · Medium ${this.evidenceHealth.medium} · Low ${this.evidenceHealth.low}`,
          },
          {
            label: 'Audit Pack Readiness',
            value: `${this.auditReadiness.percent}%`,
            note: `Missing policies ${this.auditReadiness.missingPolicies} · Missing logs ${this.auditReadiness.missingLogs}`,
          },
          {
            label: 'Submission Readiness',
            value: `${this.submissionReadiness.percent}%`,
            note: `${this.submissionReadiness.submitted}/${this.submissionReadiness.reviewed} submitted`,
          },
          {
            label: 'Overdue Evidence',
            value: `${overdueEvidence}`,
            note: 'Awaiting review >14 days',
          },
          {
            label: 'Open Risks',
            value: `${openRisks}`,
            note: 'Partial or missing controls',
          },
        ];

        const breakdown = res?.complianceBreakdown;
        this.complianceBreakdown = breakdown || this.complianceBreakdown;
        this.donutStyle = this.buildDonutStyle(this.complianceBreakdown);

        const heatmap = res?.riskHeatmap;
        this.riskHeatmap = heatmap?.matrix || [];
        this.impactLabels = heatmap?.impactLabels || [];
        this.likelihoodLabels = heatmap?.likelihoodLabels || [];

        this.frameworkMonths = res?.months || this.frameworkMonths;
        this.frameworkProgress = this.mapFrameworkProgress(res?.frameworkProgress || []);

        this.riskRows = (res?.riskControls || []).map((row) => ({
          control: row.controlId,
          owner: 'Unassigned',
          status: this.mapRiskStatus(row.status),
          due: this.formatShortDate(row.updatedAt),
          controlDbId: row.controlDbId || null,
          title: row.title || null,
        }));

        this.riskCoverageRows = (res?.riskCoverage || []).map((row) => ({
          id: row.id,
          title: row.title,
          coverage: `${row.coveragePercent}%`,
          controlCount: row.controlCount,
          controlCodes: row.controlCodes || [],
        }));

        this.activityRows = (res?.activity || []).map((item) => ({
          item: item.label,
          by: item.detail,
          time: this.formatRelative(item.time),
        }));

        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        if (err?.status === 403) {
          this.error = 'Dashboard access is restricted to managers and admins.';
        } else {
          this.error = 'Unable to load dashboard data.';
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private mapRiskStatus(status: string) {
    const value = String(status || '').toUpperCase();
    if (value === 'NOT_COMPLIANT') return 'Missing';
    if (value === 'PARTIAL') return 'Partial';
    return 'Unknown';
  }

  toggleRiskPopover(id: string) {
    this.riskPopoverId = this.riskPopoverId === id ? null : id;
  }

  openControl(row: { controlDbId?: string | null }) {
    if (!row?.controlDbId) return;
    this.router.navigate(['/control-kb', row.controlDbId]);
  }

  getHeatmapColor(impactIndex: number, likelihoodIndex: number) {
    const score = impactIndex + likelihoodIndex;
    if (score <= 2) return '#16a34a';
    if (score <= 4) return '#86efac';
    if (score <= 5) return '#facc15';
    if (score <= 6) return '#fb923c';
    return '#ef4444';
  }

  buildLinePoints(series: number[]) {
    const width = 540;
    const height = 200;
    if (!series?.length) return '';
    const step = series.length > 1 ? width / (series.length - 1) : width;
    return series
      .map((value, index) => {
        const x = Math.round(step * index);
        const y = Math.round(height - (Math.min(Math.max(value, 0), 100) / 100) * height);
        return `${x},${y}`;
      })
      .join(' ');
  }

  private mapFrameworkProgress(rows: { framework: string; series: number[] }[]) {
    const palette = ['#7c3aed', '#f59e0b', '#ef4444', '#0ea5e9', '#22c55e', '#a855f7'];
    return (rows || []).map((row, index) => ({
      framework: row.framework,
      series: row.series || [],
      color: palette[index % palette.length],
    }));
  }

  private buildDonutStyle(breakdown: {
    compliant: number;
    partial: number;
    notCompliant: number;
    unknown: number;
    total: number;
  }) {
    const total = breakdown.total || 1;
    const compliantPct = Math.round((breakdown.compliant / total) * 100);
    const partialPct = Math.round((breakdown.partial / total) * 100);
    const notCompliantPct = Math.round((breakdown.notCompliant / total) * 100);
    const unknownPct = Math.max(0, 100 - compliantPct - partialPct - notCompliantPct);
    const stops = [
      `#16a34a 0 ${compliantPct}%`,
      `#f59e0b ${compliantPct}% ${compliantPct + partialPct}%`,
      `#ef4444 ${compliantPct + partialPct}% ${compliantPct + partialPct + notCompliantPct}%`,
      `#94a3b8 ${compliantPct + partialPct + notCompliantPct}% 100%`,
    ];
    return `conic-gradient(${stops.join(', ')})`;
  }

  private formatShortDate(value: string | null) {
    if (!value) return '--';
    const date = new Date(value);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  private formatRelative(value: string | null) {
    if (!value) return '--';
    const date = new Date(value);
    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }
}
