import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ApiService, DashboardResponse } from '../../services/api.service';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.css'
})
export class DashboardPageComponent implements OnInit {
  stats: { label: string; value: string; note: string }[] = [];
  riskRows: { control: string; owner: string; status: string; due: string }[] = [];
  activityRows: { item: string; by: string; time: string }[] = [];
  loading = true;
  error = '';

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.refresh();
  }

  refresh() {
    this.loading = true;
    this.error = '';

    this.api.getDashboard('ISO').subscribe({
      next: (res: DashboardResponse) => {
        const metrics = res?.metrics;
        const coverage = metrics?.coveragePercent ?? 0;
        const evaluated = metrics?.evaluatedControls ?? 0;
        const compliant = metrics?.compliant ?? 0;
        const partial = metrics?.partial ?? 0;
        const missing = metrics?.missing ?? 0;
        const awaiting = metrics?.awaitingReview ?? 0;

        this.stats = [
          {
            label: 'Overall Coverage',
            value: `${coverage}%`,
            note: `${compliant + partial}/${evaluated} controls reviewed`,
          },
          {
            label: 'Open Gaps',
            value: `${missing}`,
            note: `${partial} partial`,
          },
          {
            label: 'Evidence Items',
            value: `${metrics?.evidenceItems ?? 0}`,
            note: `${awaiting} awaiting review`,
          },
          {
            label: 'Last Review',
            value: this.formatRelative(metrics?.lastReviewAt ?? null),
            note: res?.standard === 'ISO' ? 'ISO 27001' : res?.standard || 'All',
          },
        ];

        this.riskRows = (res?.riskControls || []).map((row) => ({
          control: row.controlId,
          owner: 'Unassigned',
          status: this.mapRiskStatus(row.status),
          due: this.formatShortDate(row.updatedAt),
        }));

        this.activityRows = (res?.activity || []).map((item) => ({
          item: item.label,
          by: item.detail,
          time: this.formatRelative(item.time),
        }));

        this.loading = false;
      },
      error: (err) => {
        if (err?.status === 403) {
          this.error = 'Dashboard access is restricted to managers and admins.';
        } else {
          this.error = 'Unable to load dashboard data.';
        }
        this.loading = false;
      },
    });
  }

  private mapRiskStatus(status: string) {
    const value = String(status || '').toUpperCase();
    if (value === 'NOT_COMPLIANT') return 'Missing';
    if (value === 'PARTIAL') return 'Partial';
    return 'Unknown';
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
