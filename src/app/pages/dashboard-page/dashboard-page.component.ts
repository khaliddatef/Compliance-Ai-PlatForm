import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterModule } from '@angular/router';
import {
  ApiService,
  AttentionTodayItem,
  DashboardFilterOptions,
  DashboardKpi,
  DashboardResponse,
  ComplianceGapItem,
  EvidenceHealthDetailV2,
  EvidenceHealthVisual,
  FrameworkComparisonV2,
  RecommendedActionV2,
  RiskDistribution,
  TrendSeriesV2,
  AuditSummary,
  ExecutiveSummary,
  RiskHeatmapControl,
  RiskDriver,
} from '../../services/api.service';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.css'
})
export class DashboardPageComponent implements OnInit {
  kpis: DashboardKpi[] = [];
  attentionToday: AttentionTodayItem[] = [];
  filterOptions: DashboardFilterOptions = {
    frameworks: [],
    businessUnits: [],
    riskCategories: [],
    timeRanges: [30, 90, 180, 365],
  };
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
  complianceGaps: ComplianceGapItem[] = [];
  gapMaxCount = 0;
  donutStyle = '';
  riskHeatmap: number[][] = [];
  riskDistribution: RiskDistribution = { high: 0, medium: 0, low: 0, total: 0, exposure: 'low' };
  riskDonutStyle = '';
  impactLabels: string[] = [];
  likelihoodLabels: string[] = [];
  riskHeatmapControls: RiskHeatmapControl[] = [];
  riskDrivers: RiskDriver[] = [];
  selectedHeatmapCell: { impactIndex: number; likelihoodIndex: number } | null = null;
  selectedRiskDriverId: string | null = null;
  riskExposureLabel: 'Low' | 'Medium' | 'High' = 'Low';
  riskInsight = '';
  frameworkProgress: { framework: string; series: number[]; color: string }[] = [];
  frameworkMonths: string[] = [];
  uploadSummary = {
    totalUploadedDocuments: 0,
    distinctMatchedControls: 0,
    documentsPerControl: [] as Array<{ controlId: string; count: number }>,
  };
  attentionItems: Array<{
    id: string;
    label: string;
    count: number;
    severity: 'high' | 'medium' | 'low';
    route: string;
    query?: Record<string, string>;
  }> = [];
  evidenceHealthDetail = {
    expiringSoon: 0,
    expired: 0,
    missing: 0,
    reusedAcrossFrameworks: 0,
    rejected: 0,
    outdated: 0,
  };
  evidenceHealthDetailV2: EvidenceHealthDetailV2 = {
    expiringIn30: 0,
    expired: 0,
    missing: 0,
    reusedAcrossFrameworks: 0,
    rejected: 0,
    outdated: 0,
  };
  evidenceHealthVisual: EvidenceHealthVisual = {
    valid: 0,
    expiringSoon: 0,
    expired: 0,
    missing: 0,
    total: 0,
  };
  trends = { riskScore: [], compliance: [], mttr: [] } as {
    riskScore: number[];
    compliance: number[];
    mttr: number[];
  };
  trendsV2: TrendSeriesV2[] = [];
  frameworkComparison: Array<{ framework: string; completionPercent: number; failedControls: number }> = [];
  frameworkComparisonV2: FrameworkComparisonV2[] = [];
  recommendedActions: Array<{
    id: string;
    title: string;
    reason: string;
    route: string;
    query?: Record<string, string>;
    severity: 'high' | 'medium' | 'low';
  }> = [];
  recommendedActionsV2: RecommendedActionV2[] = [];
  auditSummary: AuditSummary = { upcoming14: 0, upcoming30: 0, upcoming90: 0, upcoming: [] };
  executiveSummary: ExecutiveSummary | null = null;
  executiveMode = false;
  evidenceOpen = false;
  frameworkOpen = false;
  frameworkFilter = '';
  businessUnitFilter = '';
  riskCategoryFilter = '';
  rangeDays = 90;
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
    this.restoreFilters();
    this.refresh();
  }

  refresh() {
    this.loading = true;
    this.error = '';
    this.riskPopoverId = null;
    this.cdr.markForCheck();

    this.api.getDashboard({
      framework: this.frameworkFilter || undefined,
      businessUnit: this.businessUnitFilter || undefined,
      riskCategory: this.riskCategoryFilter || undefined,
      rangeDays: this.rangeDays,
    }).subscribe({
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

        this.filterOptions = res?.filterOptions || this.filterOptions;
        if (res?.appliedFilters?.rangeDays) {
          this.rangeDays = res.appliedFilters.rangeDays;
        }
        const attentionTodayRaw = Array.isArray(res?.attentionToday)
          ? res.attentionToday
          : this.mapLegacyAttention(res?.attentionItems);
        const severityRank = { high: 3, medium: 2, low: 1 };
        this.attentionToday = attentionTodayRaw
          .filter((item) => item.count > 0)
          .sort((a, b) =>
            (severityRank[b.severity] - severityRank[a.severity]) || (b.count - a.count),
          )
          .slice(0, 4);

        const breakdown = res?.complianceBreakdown;
        this.complianceBreakdown = breakdown || this.complianceBreakdown;
        this.donutStyle = this.buildDonutStyle(this.complianceBreakdown);
        this.setComplianceGaps(Array.isArray(res?.complianceGaps) ? res.complianceGaps : []);

        const heatmap = res?.riskHeatmap;
        this.riskHeatmap = heatmap?.matrix || [];
        this.impactLabels = heatmap?.impactLabels || [];
        this.likelihoodLabels = heatmap?.likelihoodLabels || [];
        this.riskHeatmapControls = Array.isArray(res?.riskHeatmapControls)
          ? res.riskHeatmapControls
          : [];
        this.riskDrivers = Array.isArray(res?.riskDrivers) ? res.riskDrivers : [];
        this.riskDistribution = res?.riskDistribution
          ? res.riskDistribution
          : this.buildRiskDistribution(this.riskHeatmap);
        this.riskExposureLabel = this.computeRiskExposureLabel(this.riskHeatmap);
        this.riskInsight = this.computeRiskInsight(this.riskHeatmap);
        this.riskDonutStyle = this.buildRiskDonutStyle(this.riskDistribution);
        this.selectedHeatmapCell = null;
        this.selectedRiskDriverId = null;

        this.frameworkMonths = res?.months || this.frameworkMonths;
        this.frameworkProgress = this.mapFrameworkProgress(res?.frameworkProgress || []);
        this.uploadSummary = res?.uploadSummary || this.uploadSummary;
        this.attentionItems = res?.attentionItems || [];
        this.evidenceHealthDetail = res?.evidenceHealthDetail || this.evidenceHealthDetail;
        this.evidenceHealthDetailV2 = res?.evidenceHealthDetailV2
          ? res.evidenceHealthDetailV2
          : this.mapEvidenceDetail(this.evidenceHealthDetail);
        this.evidenceHealthVisual = res?.evidenceHealthVisual
          ? res.evidenceHealthVisual
          : this.buildEvidenceHealthVisual(this.complianceBreakdown.total);
        this.auditSummary = res?.auditSummary || this.auditSummary;
        this.executiveSummary = res?.executiveSummary || this.executiveSummary;
        this.kpis = Array.isArray(res?.kpis) && res.kpis.length
          ? res.kpis
          : this.buildKpis({
              compliancePercent: coverage,
              riskDistribution: this.riskDistribution,
              evidenceHealthScore: this.evidenceHealth.score,
              openHighRisks: this.riskDistribution.high,
              auditsNext30: this.auditSummary.upcoming30,
              failedControls: this.complianceBreakdown.notCompliant,
            });

        this.trends = res?.trends || this.trends;
        this.trendsV2 = Array.isArray(res?.trendsV2) && res.trendsV2.length
          ? res.trendsV2
          : this.mapLegacyTrends(res?.trends, res?.months);
        this.frameworkComparison = res?.frameworkComparison || [];
        this.frameworkComparisonV2 = Array.isArray(res?.frameworkComparisonV2) && res.frameworkComparisonV2.length
          ? res.frameworkComparisonV2
          : this.mapLegacyFrameworkComparison(res?.frameworkComparison);
        this.recommendedActions = res?.recommendedActions || [];
        this.recommendedActionsV2 = Array.isArray(res?.recommendedActionsV2) && res.recommendedActionsV2.length
          ? res.recommendedActionsV2
          : this.mapLegacyRecommendedActions(res?.recommendedActions);
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

  setTrendRange(range: number) {
    if (this.rangeDays === range) return;
    this.rangeDays = range;
    this.persistFilters();
    this.refresh();
  }

  applyFilters() {
    this.persistFilters();
    this.refresh();
  }

  clearFilters() {
    this.frameworkFilter = '';
    this.businessUnitFilter = '';
    this.riskCategoryFilter = '';
    this.rangeDays = 90;
    this.persistFilters();
    this.refresh();
  }

  toggleExecutive() {
    this.executiveMode = !this.executiveMode;
  }

  toggleEvidence() {
    this.evidenceOpen = !this.evidenceOpen;
  }

  toggleFrameworkComparison() {
    this.frameworkOpen = !this.frameworkOpen;
  }

  exportExecutivePdf() {
    if (typeof window === 'undefined') return;
    window.print();
  }

  openKpi(kpi: DashboardKpi) {
    if (kpi?.drilldown?.route) {
      this.router.navigate([kpi.drilldown.route], { queryParams: kpi.drilldown.query || {} });
      return;
    }
    this.openStat(kpi?.label || '');
  }

  openTrend(series: TrendSeriesV2) {
    if (!series) return;
    if (series.id === 'compliance') {
      this.router.navigate(['/control-kb'], { queryParams: { status: 'enabled' } });
      return;
    }
    if (series.id === 'riskScore') {
      this.router.navigate(['/dashboard']);
      return;
    }
    this.router.navigate(['/uploads']);
  }

  openFrameworkComparison(row: FrameworkComparisonV2) {
    if (!row?.framework) return;
    this.router.navigate(['/control-kb'], { queryParams: { framework: row.framework } });
  }

  openAttention(item: { route: string; query?: Record<string, string> }) {
    this.router.navigate([item.route], { queryParams: item.query || {} });
  }

  getAttentionHint(item: { id?: string; label?: string }) {
    const id = String(item?.id || '').toLowerCase();
    const label = String(item?.label || '').toLowerCase();
    if (id.includes('missing-evidence') || label.includes('missing evidence')) {
      return 'Upload or map required evidence';
    }
    if (id.includes('owner') || label.includes('owner')) {
      return 'Assign risk owners';
    }
    if (id.includes('failed-controls') || id.includes('control') || label.includes('control')) {
      return 'Review control tests';
    }
    if (id.includes('audit') || label.includes('audit')) {
      return 'Prepare audit materials';
    }
    return 'Review and take action';
  }

  openRecommendation(item: { route: string; query?: Record<string, string> }) {
    this.router.navigate([item.route], { queryParams: item.query || {} });
  }

  openGap(item: ComplianceGapItem, event?: Event) {
    event?.stopPropagation();
    const id = String(item?.id || '').toLowerCase();
    const label = String(item?.label || '').toLowerCase();
    if (id.includes('missing-evidence') || label.includes('missing evidence')) {
      const query: Record<string, string> = { compliance: 'UNKNOWN', status: 'enabled' };
      if (this.frameworkFilter) {
        query['framework'] = this.frameworkFilter;
      }
      this.router.navigate(['/control-kb'], { queryParams: query });
      return;
    }
    if (item?.route) {
      this.router.navigate([item.route], { queryParams: item.query || {} });
      return;
    }
    this.router.navigate(['/control-kb'], { queryParams: { gap: item.id, status: 'enabled' } });
  }

  openStat(label: string) {
    const key = label.toLowerCase();
    if (key.includes('document')) {
      this.router.navigate(['/uploads']);
      return;
    }
    if (key.includes('evidence') || key.includes('upload')) {
      this.router.navigate(['/uploads']);
      return;
    }
    if (key.includes('risk')) {
      this.router.navigate(['/dashboard']);
      return;
    }
    if (key.includes('coverage') || key.includes('compliance')) {
      this.router.navigate(['/control-kb']);
      return;
    }
    this.router.navigate(['/dashboard']);
  }

  openComplianceStatus(
    status: 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN',
    event?: Event,
  ) {
    event?.stopPropagation();
    const query: Record<string, string> = { compliance: status, status: 'enabled' };
    if (this.frameworkFilter) {
      query['framework'] = this.frameworkFilter;
    }
    this.router.navigate(['/control-kb'], { queryParams: query });
  }

  getTrendSeries(id: 'riskScore' | 'compliance' | 'mttr') {
    return this.trendsV2.find((series) => series.id === id);
  }

  getTrendLatest(series?: TrendSeriesV2) {
    if (!series?.points?.length) return 0;
    return series.points[series.points.length - 1] ?? 0;
  }

  getTrendDelta(series?: TrendSeriesV2) {
    if (!series?.points || series.points.length < 2) return 0;
    const last = series.points[series.points.length - 1] ?? 0;
    const prev = series.points[series.points.length - 2] ?? last;
    return last - prev;
  }

  formatTrendValue(series: TrendSeriesV2 | undefined, value: number) {
    if (!series) return `${value}`;
    return series.unit === 'days' ? `${value}d` : `${value}%`;
  }

  getTrendMax(series?: TrendSeriesV2) {
    if (!series?.points?.length) return 100;
    if (series.unit !== 'days') return 100;
    const max = Math.max(...series.points);
    return Math.max(max, 1);
  }

  getTrendTooltip(series: TrendSeriesV2) {
    if (series.id === 'riskScore') {
      return 'Risk Score reflects overall exposure based on control status over time.';
    }
    if (series.id === 'mttr') {
      return 'MTTR is the mean time to remediate failed controls.';
    }
    return 'Compliance improvement trend over time.';
  }

  getGapWidth(item: ComplianceGapItem) {
    const max = this.gapMaxCount || 1;
    const pct = (item.count / max) * 100;
    return Math.max(8, Math.min(100, pct));
  }

  getGapColor(item: ComplianceGapItem) {
    const max = this.gapMaxCount || 1;
    const ratio = Math.min(1, item.count / max);
    const alpha = 0.35 + ratio * 0.6;
    return `rgba(239, 68, 68, ${alpha.toFixed(2)})`;
  }

  getEvidenceSegmentPct(kind: 'valid' | 'expiring' | 'expired' | 'missing') {
    const total = this.evidenceHealthVisual.total || 0;
    if (!total) return 0;
    const value = kind === 'valid'
      ? this.evidenceHealthVisual.valid
      : kind === 'expiring'
        ? this.evidenceHealthVisual.expiringSoon
        : kind === 'expired'
          ? this.evidenceHealthVisual.expired
          : this.evidenceHealthVisual.missing;
    return Math.max(0, Math.min(100, (value / total) * 100));
  }

  getSeverityClass(value: 'high' | 'medium' | 'low') {
    return value === 'high' ? 'severity-high' : value === 'medium' ? 'severity-medium' : 'severity-low';
  }

  getKpiTooltip(kpi: DashboardKpi) {
    const key = (kpi?.id || kpi?.label || '').toLowerCase();
    if (key.includes('evidence-health')) return 'Evidence Coverage summarizes the completeness of uploaded evidence.';
    if (key.includes('audit')) return 'Audit Readiness estimates how close you are to audit pack completeness.';
    if (key.includes('risk')) return 'Risk Score reflects overall exposure based on control status.';
    return '';
  }


  private setComplianceGaps(items: ComplianceGapItem[]) {
    this.complianceGaps = items;
    this.gapMaxCount = items.length ? Math.max(...items.map((item) => item.count)) : 0;
  }

  private buildKpis(params: {
    compliancePercent: number;
    riskDistribution: RiskDistribution;
    evidenceHealthScore: number;
    openHighRisks: number;
    auditsNext30: number;
    failedControls: number;
  }): DashboardKpi[] {
    const complianceSeverity = params.compliancePercent < 60 ? 'high' : params.compliancePercent < 80 ? 'medium' : 'low';
    const evidenceSeverity = params.evidenceHealthScore < 60 ? 'high' : params.evidenceHealthScore < 80 ? 'medium' : 'low';
    const exposure = params.riskDistribution.exposure;
    const exposureSeverity = exposure === 'high' ? 'high' : exposure === 'medium' ? 'medium' : 'low';

    return [
      {
        id: 'overall-compliance',
        label: 'Overall Compliance',
        value: `${params.compliancePercent}%`,
        severity: complianceSeverity,
        drilldown: { route: '/control-kb', query: { status: 'enabled' } },
      },
      {
        id: 'risk-exposure',
        label: 'Risk Exposure',
        value: exposure.toUpperCase(),
        severity: exposureSeverity,
        drilldown: { route: '/dashboard' },
      },
      {
        id: 'evidence-health',
        label: 'Evidence Coverage',
        value: `${params.evidenceHealthScore}%`,
        severity: evidenceSeverity,
        drilldown: { route: '/uploads' },
      },
      {
        id: 'open-high-risks',
        label: 'Open High Risks',
        value: `${params.openHighRisks}`,
        severity: params.openHighRisks ? 'high' : 'low',
        drilldown: { route: '/dashboard' },
      },
      {
        id: 'audits-next-30',
        label: 'Audits Next 30 Days',
        value: `${params.auditsNext30}`,
        severity: params.auditsNext30 ? 'medium' : 'low',
        drilldown: { route: '/dashboard', query: { range: '30' } },
      },
      {
        id: 'failed-controls',
        label: 'Failed Controls',
        value: `${params.failedControls}`,
        severity: params.failedControls ? 'high' : 'low',
        drilldown: { route: '/control-kb', query: { status: 'enabled' } },
      },
    ];
  }

  private mapLegacyAttention(items?: Array<{ id: string; label: string; count: number; severity: 'high' | 'medium' | 'low'; route: string; query?: Record<string, string> }>) {
    if (!items?.length) return [];
    return items.map((item) => ({
      id: item.id,
      label: item.label,
      count: item.count,
      severity: item.severity,
      kind: 'control' as const,
      route: item.route,
      query: item.query,
    }));
  }

  private mapEvidenceDetail(legacy: { expiringSoon: number; expired: number; missing: number; reusedAcrossFrameworks: number; rejected: number; outdated: number }) {
    return {
      expiringIn30: legacy.expiringSoon,
      expired: legacy.expired,
      missing: legacy.missing,
      reusedAcrossFrameworks: legacy.reusedAcrossFrameworks,
      rejected: legacy.rejected,
      outdated: legacy.outdated,
    };
  }

  private buildEvidenceHealthVisual(totalControls: number): EvidenceHealthVisual {
    const expiring = this.evidenceHealthDetailV2.expiringIn30 || 0;
    const expired = this.evidenceHealthDetailV2.expired || 0;
    const missing = this.evidenceHealthDetailV2.missing || 0;
    const used = expiring + expired + missing;
    const total = Math.max(totalControls || 0, used);
    return {
      valid: Math.max(0, total - used),
      expiringSoon: expiring,
      expired,
      missing,
      total,
    };
  }

  private mapLegacyTrends(
    legacy?: { riskScore: number[]; compliance: number[]; mttr: number[] },
    months?: string[],
  ): TrendSeriesV2[] {
    if (!legacy) return [];
    const dates = months?.length ? months : legacy.riskScore.map((_, idx) => `M${idx + 1}`);
    return [
      { id: 'riskScore', label: 'Risk Score', points: legacy.riskScore || [], dates, rangeDays: this.rangeDays, unit: 'percent' },
      { id: 'compliance', label: 'Compliance', points: legacy.compliance || [], dates, rangeDays: this.rangeDays, unit: 'percent' },
      { id: 'mttr', label: 'MTTR', points: legacy.mttr || [], dates, rangeDays: this.rangeDays, unit: 'days' },
    ];
  }

  private mapLegacyFrameworkComparison(
    legacy?: Array<{ framework: string; completionPercent: number; failedControls: number }>,
  ): FrameworkComparisonV2[] {
    if (!legacy?.length) return [];
    return legacy.map((row) => ({
      framework: row.framework,
      totalControls: 0,
      compliant: 0,
      partial: 0,
      notCompliant: row.failedControls || 0,
      unknown: 0,
      completionPercent: row.completionPercent || 0,
      failedControls: row.failedControls || 0,
    }));
  }

  private mapLegacyRecommendedActions(
    legacy?: Array<{ id: string; title: string; reason: string; route: string; query?: Record<string, string>; severity: 'high' | 'medium' | 'low' }>,
  ): RecommendedActionV2[] {
    if (!legacy?.length) return [];
    return legacy.map((item) => ({
      id: item.id,
      title: item.title,
      reason: item.reason,
      route: item.route,
      query: item.query,
      severity: item.severity,
    }));
  }

  private persistFilters() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('dashboardFilters', JSON.stringify({
      frameworkFilter: this.frameworkFilter,
      businessUnitFilter: this.businessUnitFilter,
      riskCategoryFilter: this.riskCategoryFilter,
      rangeDays: this.rangeDays,
    }));
  }

  private restoreFilters() {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem('dashboardFilters');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      this.frameworkFilter = parsed.frameworkFilter || '';
      this.businessUnitFilter = parsed.businessUnitFilter || '';
      this.riskCategoryFilter = parsed.riskCategoryFilter || '';
      this.rangeDays = Number(parsed.rangeDays) || 90;
    } catch {
      // ignore
    }
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

  getHeatmapColor(impactIndex: number, likelihoodIndex: number, value?: number) {
    const score = (impactIndex + 1) + (likelihoodIndex + 1);
    if (score >= 6) return '#e05a52';
    if (score >= 5) return '#f07c5a';
    if (score >= 4) return '#f4b562';
    if (score >= 3) return '#97d86d';
    return '#2f8f4e';
  }

  getHeatmapTooltip(impactIndex: number, likelihoodIndex: number, value: number) {
    const impact = this.getImpactLabel(impactIndex);
    const likelihood = this.getLikelihoodLabel(likelihoodIndex);
    const count = Number(value || 0);
    return `${impact} impact · ${likelihood} likelihood · ${count} risk${count === 1 ? '' : 's'}`;
  }

  getRiskBadgeClass() {
    return `risk-badge ${this.riskExposureLabel.toLowerCase()}`;
  }

  formatStatusLabel(value: string) {
    const text = String(value || 'UNKNOWN')
      .replace(/_/g, ' ')
      .toLowerCase();
    return text.replace(/\b\w/g, (match) => match.toUpperCase());
  }

  formatHeatmapValue(value: number) {
    const num = Number(value || 0);
    return num < 10 ? `0${num}` : `${num}`;
  }

  toggleHeatmapCell(impactIndex: number, likelihoodIndex: number) {
    if (
      this.selectedHeatmapCell &&
      this.selectedHeatmapCell.impactIndex === impactIndex &&
      this.selectedHeatmapCell.likelihoodIndex === likelihoodIndex
    ) {
      this.selectedHeatmapCell = null;
      return;
    }
    this.selectedHeatmapCell = { impactIndex, likelihoodIndex };
    this.selectedRiskDriverId = null;
  }

  clearHeatmapSelection() {
    this.selectedHeatmapCell = null;
    this.selectedRiskDriverId = null;
  }

  isHeatmapCellSelected(impactIndex: number, likelihoodIndex: number) {
    return (
      this.selectedHeatmapCell?.impactIndex === impactIndex &&
      this.selectedHeatmapCell?.likelihoodIndex === likelihoodIndex
    );
  }

  get selectedHeatmapLabel() {
    if (!this.selectedHeatmapCell) return '';
    const impact = this.getImpactLabel(this.selectedHeatmapCell.impactIndex);
    const likelihood = this.getLikelihoodLabel(this.selectedHeatmapCell.likelihoodIndex);
    return `${impact} impact · ${likelihood} likelihood`;
  }

  get selectedRiskDriverLabel() {
    if (!this.selectedRiskDriverId) return '';
    const match = this.riskDrivers.find((driver) => driver.id === this.selectedRiskDriverId);
    return match?.label || 'Risk driver';
  }

  get hasRiskFilter() {
    return !!this.selectedHeatmapCell || !!this.selectedRiskDriverId;
  }

  get selectedRiskFilterLabel() {
    if (this.selectedRiskDriverId) {
      return `Driver: ${this.selectedRiskDriverLabel}`;
    }
    if (this.selectedHeatmapCell) {
      return this.selectedHeatmapLabel;
    }
    return '';
  }

  get filteredRiskControls() {
    if (!this.hasRiskFilter) return [];
    let controls = this.riskHeatmapControls;
    if (this.selectedHeatmapCell) {
      const impact = this.getImpactLabel(this.selectedHeatmapCell.impactIndex);
      const likelihood = this.getLikelihoodLabel(this.selectedHeatmapCell.likelihoodIndex);
      controls = controls.filter((item) => item.impact === impact && item.likelihood === likelihood);
    }
    if (this.selectedRiskDriverId) {
      controls = controls.filter((item) => item.driverId === this.selectedRiskDriverId);
    }
    return controls;
  }

  toggleRiskDriver(driverId: string) {
    const driver = this.riskDrivers.find((item) => item.id === driverId);
    const id = String(driver?.id || driverId || '').toLowerCase();
    const label = String(driver?.label || '').toLowerCase();
    if (id.includes('missing-evidence') || label.includes('missing evidence')) {
      const query: Record<string, string> = { compliance: 'UNKNOWN', status: 'enabled' };
      if (this.frameworkFilter) {
        query['framework'] = this.frameworkFilter;
      }
      this.router.navigate(['/control-kb'], { queryParams: query });
      return;
    }
    if (this.selectedRiskDriverId === driverId) {
      this.selectedRiskDriverId = null;
      return;
    }
    this.selectedRiskDriverId = driverId;
    this.selectedHeatmapCell = null;
  }

  clearRiskFilters() {
    this.selectedHeatmapCell = null;
    this.selectedRiskDriverId = null;
  }

  getRiskDriverWidth(driver: RiskDriver) {
    if (!this.riskDrivers.length) return 0;
    const max = Math.max(...this.riskDrivers.map((item) => item.count || 0), 1);
    const pct = (driver.count / max) * 100;
    return Math.max(8, Math.min(100, pct));
  }

  getRiskDriverColor(index: number) {
    if (index === 0) return '#ef4444';
    if (index === 1) return '#f59e0b';
    return '#94a3b8';
  }

  getRiskDriverTooltip(driver: RiskDriver) {
    const count = driver.count || 0;
    return `${driver.label} · ${count} risk${count === 1 ? '' : 's'}`;
  }

  getComplianceFilterForCell(rowIndex: number | string, colIndex: number | string) {
    const r = Number(rowIndex);
    const c = Number(colIndex);
    if (r === 1 && c === 1) return 'UNKNOWN';
    if (r === 0 && c === 0) return 'COMPLIANT';
    return 'COMPLIANT';
  }

  openControlsForHeatmapCell(
    rowIndex: number,
    colIndex: number,
    value: number,
    event?: Event,
  ) {
    event?.preventDefault();
    event?.stopPropagation();
    if (!value || value <= 0) return;
    const compliance = this.getComplianceFilterForCell(rowIndex, colIndex);
    this.router.navigate(['/control-kb'], { queryParams: { compliance } });
  }

  get riskDriversContext() {
    if (!this.riskDrivers.length) return '';
    if (this.riskDrivers.length === 1) {
      const label = this.riskDrivers[0]?.label || 'this driver';
      return `100% of current risk exposure is driven by ${label.toLowerCase()}`;
    }
    const total = this.riskDrivers.reduce((acc, item) => acc + (item.count || 0), 0);
    const top = this.riskDrivers[0];
    if (total && top && top.count / total >= 0.7) {
      return 'Single dominant risk driver detected';
    }
    return '';
  }

  private computeRiskExposureLabel(matrix: number[][]): 'Low' | 'Medium' | 'High' {
    if (!matrix?.length) return 'Low';
    let hasMedium = false;
    let hasHigh = false;
    for (let r = 0; r < matrix.length; r += 1) {
      for (let c = 0; c < (matrix[r] || []).length; c += 1) {
        const value = matrix[r][c] || 0;
        if (!value) continue;
        const score = (r + 1) + (c + 1);
        if (score >= 5) hasHigh = true;
        else if (score >= 4) hasMedium = true;
      }
    }
    if (hasHigh) return 'High';
    if (hasMedium) return 'Medium';
    return 'Low';
  }

  private computeRiskInsight(matrix: number[][]) {
    const total = matrix.reduce(
      (acc, row) => acc + (row || []).reduce((sum, value) => sum + (value || 0), 0),
      0,
    );
    if (!total) {
      return '';
    }

    let highCount = 0;
    let mediumCount = 0;
    let maxValue = 0;
    let maxRow = 0;
    let maxCol = 0;
    for (let r = 0; r < matrix.length; r += 1) {
      for (let c = 0; c < (matrix[r] || []).length; c += 1) {
        const value = matrix[r][c] || 0;
        if (!value) continue;
        const score = (r + 1) + (c + 1);
        if (score >= 5) highCount += value;
        else if (score >= 4) mediumCount += value;
        if (value > maxValue) {
          maxValue = value;
          maxRow = r;
          maxCol = c;
        }
      }
    }

    if (highCount === 0) {
      if (mediumCount / total >= 0.5) {
        return 'Risk exposure is stable but requires monitoring';
      }
      return '';
    }

    if (mediumCount / total >= 0.5) {
      return 'Risk exposure is stable but requires monitoring';
    }

    const impact = this.getImpactLabel(maxRow);
    const likelihood = this.getLikelihoodLabel(maxCol);
    return `${maxValue} risks are concentrated in ${impact} impact and ${likelihood} likelihood.`;
  }

  private getImpactLabel(index: number) {
    return this.impactLabels[index] || 'Low';
  }

  private getLikelihoodLabel(index: number) {
    return this.likelihoodLabels[index] || 'Low';
  }

  buildLinePoints(series: number[], maxValue = 100) {
    const width = 540;
    const height = 200;
    if (!series?.length) return '';
    const step = series.length > 1 ? width / (series.length - 1) : width;
    return series
      .map((value, index) => {
        const x = Math.round(step * index);
        const clamped = Math.min(Math.max(value, 0), maxValue || 1);
        const y = Math.round(height - (clamped / (maxValue || 1)) * height);
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

  private buildRiskDistribution(matrix: number[][]): RiskDistribution {
    const distribution: RiskDistribution = { high: 0, medium: 0, low: 0, total: 0, exposure: 'low' };
    for (let row = 0; row < matrix.length; row += 1) {
      const cols = matrix[row] || [];
      for (let col = 0; col < cols.length; col += 1) {
        const value = Number(cols[col] || 0);
        if (!value) continue;
        distribution.total += value;
        const score = (row + 1) + (col + 1);
        if (score >= 5) distribution.high += value;
        else if (score >= 4) distribution.medium += value;
        else distribution.low += value;
      }
    }
    if (distribution.high > 0) distribution.exposure = 'high';
    else if (distribution.medium > 0) distribution.exposure = 'medium';
    return distribution;
  }

  private buildRiskDonutStyle(distribution: RiskDistribution) {
    if (!distribution.total) return 'conic-gradient(#e2e8f0 0 100%)';
    const total = distribution.total || 1;
    const lowPct = Math.round((distribution.low / total) * 100);
    const mediumPct = Math.round((distribution.medium / total) * 100);
    const highPct = Math.max(0, 100 - lowPct - mediumPct);
    const stops = [
      `#16a34a 0 ${lowPct}%`,
      `#f59e0b ${lowPct}% ${lowPct + mediumPct}%`,
      `#ef4444 ${lowPct + mediumPct}% ${lowPct + mediumPct + highPct}%`,
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


