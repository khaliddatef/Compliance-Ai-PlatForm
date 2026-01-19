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
        ];

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
