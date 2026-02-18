import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, UploadDocumentRecord } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

type DetailTab = 'overview' | 'analysis' | 'activity';
type ComplianceStatus = 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN';
type UploadStatusCode = 'UPLOADED' | 'REVIEWED' | 'READY' | 'SUBMITTED';

type HeatCell = {
  value: string;
  tone: 'low' | 'moderate' | 'elevated' | 'high';
  active: boolean;
};

type HeatRow = {
  label: string;
  score: number;
  cells: HeatCell[];
};

type UploadDetailView = {
  id: string;
  conversationId: string;
  name: string;
  mimeType: string;
  sizeLabel: string;
  sizeBytes: number;
  framework: string;
  frameworkReferences: string[];
  statusLabel: string;
  statusCode: UploadStatusCode;
  statusClass: string;
  complianceStatus: ComplianceStatus;
  complianceLabel: string;
  complianceClass: string;
  riskLabel: 'Low' | 'Medium' | 'High';
  riskClass: 'risk-low' | 'risk-medium' | 'risk-high';
  uploadedAt: Date | null;
  reviewedAt: Date | null;
  submittedAt: Date | null;
  chatTitle: string;
  uploaderLabel: string;
  controlCode: string;
  docType: string;
  chunks: number;
  recommendations: string[];
  note: string;
  readinessScore: number;
  quickQuestions: number;
  quickRisks: number;
  quickIncidents: number;
  heatRows: HeatRow[];
};

@Component({
  selector: 'app-upload-detail-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './upload-detail-page.component.html',
  styleUrl: './upload-detail-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadDetailPageComponent implements OnInit {
  loading = true;
  error = '';
  processing = false;
  menuOpen = false;
  activeTab: DetailTab = 'overview';
  uploadId = '';
  detail: UploadDetailView | null = null;

  readonly tabs: Array<{ id: DetailTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'analysis', label: 'Assessment' },
    { id: 'activity', label: 'Activity' },
  ];

  readonly complianceOptionItems: Array<{ value: ComplianceStatus; label: string }> = [
    { value: 'COMPLIANT', label: 'Compliant' },
    { value: 'PARTIAL', label: 'Partially compliant' },
    { value: 'NOT_COMPLIANT', label: 'Not compliant' },
    { value: 'UNKNOWN', label: 'Unknown' },
  ];
  readonly skeletonRows = [1, 2, 3];

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      this.uploadId = String(params.get('id') || '').trim();
      this.load();
    });
  }

  get canManageStatus() {
    const role = (this.auth.user()?.role || 'USER').toUpperCase();
    return role === 'ADMIN' || role === 'MANAGER';
  }

  get scoreGradient() {
    const score = this.detail?.readinessScore ?? 0;
    return `conic-gradient(#1d4ed8 ${score}%, #dbeafe ${score}% 100%)`;
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.menuOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.menuOpen = false;
  }

  selectTab(tab: DetailTab) {
    this.activeTab = tab;
  }

  toggleMenu(event?: Event) {
    event?.stopPropagation();
    this.menuOpen = !this.menuOpen;
  }

  backToUploads() {
    this.router.navigate(['/uploads']);
  }

  trackByIndex(index: number, _item?: unknown) {
    return index;
  }

  trackByTab(_index: number, tab: { id: DetailTab }) {
    return tab.id;
  }

  trackByText(_index: number, value: string) {
    return value;
  }

  trackByComplianceOption(_index: number, option: { value: ComplianceStatus }) {
    return option.value;
  }

  trackByHeatRow(_index: number, row: HeatRow) {
    return row.label;
  }

  downloadDocument() {
    if (!this.detail) return;
    const fileId = this.detail.id;
    const downloadName = this.detail.name || 'document';
    this.api.downloadUpload(fileId).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = downloadName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.error = 'Unable to download this file right now.';
        this.cdr.markForCheck();
      },
    });
  }

  markReviewed() {
    if (!this.detail || !this.canManageStatus || this.processing) return;
    this.processing = true;
    this.api.updateUploadStatus(this.detail.id, 'REVIEWED').subscribe({
      next: (res) => {
        if (res?.document) this.setDocument(res.document);
        this.processing = false;
        this.menuOpen = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.processing = false;
        this.error = 'Unable to mark this file as reviewed.';
        this.cdr.markForCheck();
      },
    });
  }

  markSubmitted() {
    if (!this.detail || !this.canManageStatus || this.processing) return;

    const normalized = this.detail.complianceStatus;
    if (normalized !== 'COMPLIANT') {
      const proceed = window.confirm('This file is not marked COMPLIANT. Submit anyway?');
      if (!proceed) return;
    }

    this.processing = true;
    this.api.updateUploadStatus(this.detail.id, 'SUBMITTED').subscribe({
      next: (res) => {
        if (res?.document) this.setDocument(res.document);
        this.processing = false;
        this.menuOpen = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.processing = false;
        this.error = 'Unable to submit this file right now.';
        this.cdr.markForCheck();
      },
    });
  }

  reevaluateDocument() {
    if (!this.detail || this.processing) return;
    this.processing = true;
    this.api.reevaluateUpload(this.detail.id).subscribe({
      next: (res) => {
        if (res?.document) this.setDocument(res.document);
        this.processing = false;
        this.menuOpen = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.processing = false;
        this.error = 'Unable to reevaluate this file right now.';
        this.cdr.markForCheck();
      },
    });
  }

  deleteDocument() {
    if (!this.detail || !this.canManageStatus || this.processing) return;
    const confirmed = window.confirm(`Delete ${this.detail.name}?`);
    if (!confirmed) return;

    this.processing = true;
    this.api.deleteUpload(this.detail.id).subscribe({
      next: () => {
        this.processing = false;
        this.router.navigate(['/uploads']);
      },
      error: () => {
        this.processing = false;
        this.error = 'Unable to delete this file right now.';
        this.cdr.markForCheck();
      },
    });
  }

  updateCompliance(status: ComplianceStatus) {
    if (!this.detail || !this.canManageStatus || this.processing) return;
    this.processing = true;
    this.api.updateUploadMatchStatus(this.detail.id, status).subscribe({
      next: (res) => {
        if (res?.document) this.setDocument(res.document);
        this.processing = false;
        this.menuOpen = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.processing = false;
        this.error = 'Unable to update compliance right now.';
        this.cdr.markForCheck();
      },
    });
  }

  openControlKb() {
    if (!this.detail) return;
    const params: Record<string, string> = {};
    if (this.detail.controlCode) {
      params['q'] = this.detail.controlCode;
    }
    if (this.detail.frameworkReferences.length) {
      params['frameworkRef'] = this.detail.frameworkReferences[0];
    }
    this.router.navigate(['/control-kb'], { queryParams: params });
  }

  openFrameworkReference(reference: string) {
    const ref = String(reference || '').trim();
    if (!ref) return;
    this.router.navigate(['/control-kb'], { queryParams: { frameworkRef: ref } });
  }

  private load() {
    if (!this.uploadId) {
      this.loading = false;
      this.error = 'Invalid file identifier.';
      return;
    }

    this.loading = true;
    this.error = '';
    this.detail = null;
    this.cdr.markForCheck();

    this.api.getUpload(this.uploadId).subscribe({
      next: (res) => {
        this.setDocument(res?.document || null);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.error = 'Unable to load file details.';
        this.cdr.markForCheck();
      },
    });
  }

  private setDocument(doc: UploadDocumentRecord | null) {
    if (!doc) {
      this.detail = null;
      return;
    }
    this.detail = this.mapDocument(doc);
  }

  private mapDocument(doc: UploadDocumentRecord): UploadDetailView {
    const statusMeta = this.mapUploadStatus(doc.submittedAt, doc.reviewedAt, doc.matchStatus);
    const compliance = this.normalizeCompliance(doc.matchStatus);

    const recommendations = Array.isArray(doc.matchRecommendations)
      ? doc.matchRecommendations.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    const references = Array.isArray(doc.frameworkReferences)
      ? doc.frameworkReferences.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    const riskLabel = this.getRiskLabel(compliance);
    const riskClass = riskLabel === 'High' ? 'risk-high' : riskLabel === 'Medium' ? 'risk-medium' : 'risk-low';
    const readinessScore = this.calculateReadiness(statusMeta.code, compliance);

    const impactScore = this.getImpactScore(compliance);
    const likelihoodScore = this.getLikelihoodScore(statusMeta.code);

    const uploadedAt = this.parseDate(doc.createdAt);
    const reviewedAt = this.parseDate(doc.reviewedAt);
    const submittedAt = this.parseDate(doc.submittedAt);

    return {
      id: doc.id,
      conversationId: String(doc.conversationId || ''),
      name: String(doc.originalName || 'Document'),
      mimeType: String(doc.mimeType || 'Unknown'),
      sizeLabel: this.formatSize(doc.sizeBytes ?? 0),
      sizeBytes: Number(doc.sizeBytes ?? 0),
      framework: this.resolveFrameworkLabel(doc),
      frameworkReferences: references,
      statusLabel: statusMeta.label,
      statusCode: statusMeta.code,
      statusClass: statusMeta.className,
      complianceStatus: compliance,
      complianceLabel: this.getComplianceLabel(compliance),
      complianceClass: this.getComplianceClass(compliance),
      riskLabel,
      riskClass,
      uploadedAt,
      reviewedAt,
      submittedAt,
      chatTitle: String(doc.conversation?.title || '—'),
      uploaderLabel: this.formatUploader(doc),
      controlCode: String(doc.matchControlId || ''),
      docType: String(doc.docType || 'Uncategorized'),
      chunks: Number(doc._count?.chunks || 0),
      recommendations,
      note: String(doc.matchNote || this.defaultAssessmentNote(compliance)).trim(),
      readinessScore,
      quickQuestions: Math.max(0, recommendations.length),
      quickRisks: this.quickRiskCount(compliance),
      quickIncidents: submittedAt ? 1 : 0,
      heatRows: this.buildHeatRows(impactScore, likelihoodScore),
    };
  }

  private mapUploadStatus(
    submittedAt?: string | null,
    reviewedAt?: string | null,
    matchStatus?: string | null,
  ): { label: string; className: string; code: UploadStatusCode } {
    if (submittedAt) {
      return { label: 'Submitted', className: 'submitted', code: 'SUBMITTED' };
    }
    if (reviewedAt) {
      return { label: 'Reviewed', className: 'reviewed', code: 'REVIEWED' };
    }
    const normalized = this.normalizeCompliance(matchStatus);
    if (normalized === 'COMPLIANT') {
      return { label: 'Ready to submit', className: 'ready', code: 'READY' };
    }
    return { label: 'Uploaded', className: 'uploaded', code: 'UPLOADED' };
  }

  getComplianceLabel(status: ComplianceStatus) {
    if (status === 'COMPLIANT') return 'Compliant';
    if (status === 'PARTIAL') return 'Partially compliant';
    if (status === 'NOT_COMPLIANT') return 'Not compliant';
    return 'Unknown';
  }

  private getComplianceClass(status: ComplianceStatus) {
    if (status === 'COMPLIANT') return 'is-compliant';
    if (status === 'PARTIAL') return 'is-partial';
    if (status === 'NOT_COMPLIANT') return 'is-not-compliant';
    return 'is-unknown';
  }

  private normalizeCompliance(value?: string | null): ComplianceStatus {
    const normalized = String(value || '').toUpperCase();
    if (normalized === 'COMPLIANT') return 'COMPLIANT';
    if (normalized === 'PARTIAL') return 'PARTIAL';
    if (normalized === 'NOT_COMPLIANT') return 'NOT_COMPLIANT';
    return 'UNKNOWN';
  }

  private getRiskLabel(status: ComplianceStatus): 'Low' | 'Medium' | 'High' {
    if (status === 'NOT_COMPLIANT') return 'High';
    if (status === 'PARTIAL') return 'Medium';
    if (status === 'COMPLIANT') return 'Low';
    return 'Medium';
  }

  private calculateReadiness(status: UploadStatusCode, compliance: ComplianceStatus) {
    const statusScore =
      status === 'SUBMITTED' ? 78 : status === 'REVIEWED' ? 60 : status === 'READY' ? 52 : 34;
    const complianceBoost =
      compliance === 'COMPLIANT' ? 22 : compliance === 'PARTIAL' ? 8 : compliance === 'NOT_COMPLIANT' ? -12 : -4;
    return Math.max(0, Math.min(100, statusScore + complianceBoost));
  }

  private getImpactScore(status: ComplianceStatus) {
    if (status === 'NOT_COMPLIANT') return 5;
    if (status === 'PARTIAL') return 3;
    if (status === 'COMPLIANT') return 1;
    return 2;
  }

  private getLikelihoodScore(status: UploadStatusCode) {
    if (status === 'SUBMITTED') return 1;
    if (status === 'REVIEWED') return 2;
    if (status === 'READY') return 3;
    return 4;
  }

  private buildHeatRows(activeImpact: number, activeLikelihood: number): HeatRow[] {
    const impactRows: Array<{ label: string; score: number }> = [
      { label: 'Critical (5)', score: 5 },
      { label: 'Very High (4)', score: 4 },
      { label: 'High (3)', score: 3 },
      { label: 'Medium (2)', score: 2 },
      { label: 'Low (1)', score: 1 },
    ];

    const likelihoodColumns = [1, 2, 3, 4, 5];

    return impactRows.map((row) => ({
      label: row.label,
      score: row.score,
      cells: likelihoodColumns.map((likelihood) => {
        const risk = row.score * likelihood;
        const tone: HeatCell['tone'] =
          risk <= 5 ? 'low' : risk <= 10 ? 'moderate' : risk <= 16 ? 'elevated' : 'high';
        return {
          value: String(risk).padStart(2, '0'),
          tone,
          active: row.score === activeImpact && likelihood === activeLikelihood,
        };
      }),
    }));
  }

  private quickRiskCount(status: ComplianceStatus) {
    if (status === 'NOT_COMPLIANT') return 10;
    if (status === 'PARTIAL') return 5;
    if (status === 'COMPLIANT') return 1;
    return 3;
  }

  private defaultAssessmentNote(status: ComplianceStatus) {
    if (status === 'COMPLIANT') return 'Evidence appears to satisfy the linked control.';
    if (status === 'PARTIAL') return 'Evidence partially satisfies the linked control.';
    if (status === 'NOT_COMPLIANT') return 'Evidence does not satisfy the linked control requirements yet.';
    return 'Additional review is required to determine compliance confidence.';
  }

  private resolveFrameworkLabel(doc: UploadDocumentRecord) {
    const firstRef = Array.isArray(doc.frameworkReferences) ? doc.frameworkReferences[0] : '';
    if (String(firstRef || '').trim()) return 'Mapped framework';
    return 'Active framework';
  }

  private formatUploader(doc: UploadDocumentRecord) {
    const name = String(doc.conversation?.user?.name || '').trim();
    const email = String(doc.conversation?.user?.email || '').trim();
    if (name && email) return `${name} · ${email}`;
    return name || email || '—';
  }

  private formatSize(bytes: number) {
    if (!bytes || bytes <= 0) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  private parseDate(value?: string | null) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
