import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, firstValueFrom, forkJoin, of } from 'rxjs';
import {
  ApiService,
  ControlDefinitionRecord,
  EvidenceQualityPayload,
  EvidenceRecord,
  UploadDocumentRecord,
} from '../../services/api.service';
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

type LinkControlOption = {
  id: string;
  controlCode: string;
  title: string;
  alreadyLinked: boolean;
};

type UploadDetailView = {
  id: string;
  conversationId: string;
  name: string;
  detailsTitle: string;
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
  analysisInsights: any | null;
  readinessScore: number;
  quickQuestions: number;
  quickRisks: number;
  quickIncidents: number;
  heatRows: HeatRow[];
};

@Component({
  selector: 'app-upload-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './upload-detail-page.component.html',
  styleUrl: './upload-detail-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadDetailPageComponent implements OnInit {
  loading = true;
  evidenceLoading = false;
  error = '';
  evidenceNotice = '';
  processing = false;
  evidenceBusy = false;
  menuOpen = false;
  showLinkControlModal = false;
  linkControlLoading = false;
  linkControlSaving = false;
  linkControlError = '';
  linkControlQuery = '';
  linkControlOptions: LinkControlOption[] = [];
  linkControlSelectedIds: string[] = [];
  activeTab: DetailTab = 'overview';
  uploadId = '';
  detail: UploadDetailView | null = null;
  evidenceRecord: EvidenceRecord | null = null;
  evidenceQuality: EvidenceQualityPayload | null = null;
  private activeFrameworkLabel = '';

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

  get evidenceGradeClass() {
    const grade = this.evidenceQuality?.grade || this.evidenceRecord?.qualityGrade || '';
    if (grade === 'STRONG') return 'grade-strong';
    if (grade === 'MEDIUM') return 'grade-medium';
    return 'grade-weak';
  }

  get evidenceBreakdownRows() {
    const factors = this.evidenceQuality?.factors;
    if (!factors) return [];
    return [
      { key: 'Relevance', points: factors.relevance.points, max: factors.relevance.max },
      { key: 'Reliability', points: factors.reliability.points, max: factors.reliability.max },
      { key: 'Freshness', points: factors.freshness.points, max: factors.freshness.max },
      { key: 'Completeness', points: factors.completeness.points, max: factors.completeness.max },
    ];
  }

  get evidenceTopReasons() {
    return (this.evidenceQuality?.factors?.reasons || []).slice(0, 3);
  }

  get evidenceChecklist() {
    if (!this.evidenceRecord) return [];
    const status = String(this.evidenceRecord.status || '').toUpperCase();
    return [
      {
        label: 'Link to control',
        done: (this.evidenceRecord.links?.length || this.evidenceRecord.linksCount || 0) > 0,
      },
      {
        label: 'Review evidence',
        done: status === 'REVIEWED' || status === 'ACCEPTED' || status === 'REJECTED',
      },
      {
        label: 'Set expiry',
        done: Boolean(this.evidenceRecord.validTo),
      },
    ];
  }

  get insights() {
    return this.detail?.analysisInsights || null;
  }

  get governanceSummaryRows() {
    const governance = this.insights?.governance;
    if (!governance) return [];
    const rows = [
      { label: 'Policy title', value: governance?.policyTitle?.value || '—' },
      { label: 'Version', value: governance?.version?.value || '—' },
      { label: 'Owner', value: governance?.owner?.value || '—' },
      { label: 'Approved by', value: governance?.approvedBy?.value || '—' },
      { label: 'Approval date', value: governance?.approvalDate?.value || '—' },
      { label: 'Effective date', value: governance?.effectiveDate?.value || '—' },
      { label: 'Next review', value: governance?.nextReviewDate?.value || '—' },
    ];
    return rows;
  }

  get insightsControlReferences() {
    const items = Array.isArray(this.insights?.controlReferences)
      ? this.insights.controlReferences
      : [];
    return items.slice(0, 8);
  }

  get insightsObligations() {
    const items = Array.isArray(this.insights?.obligations)
      ? this.insights.obligations
      : [];
    return items.slice(0, 6);
  }

  get insightsArtifacts() {
    const items = Array.isArray(this.insights?.evidenceArtifacts)
      ? this.insights.evidenceArtifacts
      : [];
    return items.slice(0, 8);
  }

  get insightsGaps() {
    const items = Array.isArray(this.insights?.gaps) ? this.insights.gaps : [];
    return items.slice(0, 6);
  }

  get insightsActions() {
    const items = Array.isArray(this.insights?.suggestedActions)
      ? this.insights.suggestedActions
      : [];
    return items.slice(0, 6);
  }

  get filteredLinkControlOptions() {
    const query = this.normalizeToken(this.linkControlQuery);
    if (!query) return this.linkControlOptions;
    return this.linkControlOptions.filter((option) => {
      const token = this.normalizeToken(`${option.controlCode} ${option.title} ${option.id}`);
      return token.includes(query);
    });
  }

  get linkSelectedCount() {
    return this.linkControlSelectedIds.length;
  }

  get linkedControlLabel() {
    const fromEvidence = this.getLinkedControlCodesFromEvidence();
    if (fromEvidence.length) {
      if (fromEvidence.length === 1) return fromEvidence[0];
      return `${fromEvidence[0]} +${fromEvidence.length - 1} more`;
    }
    const linksCount = Number(this.evidenceRecord?.linksCount || 0);
    if (linksCount > 0) {
      return `Linked to ${linksCount} control(s)`;
    }
    const fromDocument = String(this.detail?.controlCode || '').trim();
    return fromDocument || 'Not mapped yet';
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.menuOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.menuOpen = false;
    if (this.showLinkControlModal && !this.linkControlSaving) {
      this.closeLinkControlModal();
    }
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

  trackByLinkControlOption(_index: number, option: LinkControlOption) {
    return option.id;
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
    const controlCode = String(this.detail.controlCode || '').trim();
    if (!controlCode) {
      this.navigateToControlKbList();
      return;
    }

    this.api
      .listControlDefinitions({
        query: controlCode,
        page: 1,
        pageSize: 50,
      })
      .subscribe({
        next: (res) => {
          const items = Array.isArray(res?.items) ? res.items : [];
          const matched = this.findBestControlMatch(
            items,
            controlCode,
            this.detail?.frameworkReferences || [],
            this.detail?.framework || '',
          );
          if (matched?.id) {
            this.router.navigate(['/control-kb', matched.id]);
            return;
          }
          this.navigateToControlKbList();
        },
        error: () => {
          this.navigateToControlKbList();
        },
      });
  }

  private navigateToControlKbList() {
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

  recomputeEvidenceQuality() {
    if (!this.evidenceRecord?.id || this.evidenceBusy) return;
    this.evidenceBusy = true;
    this.evidenceNotice = '';
    this.api
      .recomputeEvidenceQuality(
        this.evidenceRecord.id,
        {
          reason: 'MANUAL_RECOMPUTE_FROM_FILE_DETAILS',
          force: true,
        },
        crypto.randomUUID(),
      )
      .subscribe({
        next: (res) => {
          this.evidenceQuality = res?.quality || null;
          this.evidenceNotice = res?.replayed
            ? 'Recompute replayed from idempotency cache.'
            : 'Quality recomputed successfully.';
          this.evidenceBusy = false;
          this.refreshEvidence();
        },
        error: () => {
          this.evidenceBusy = false;
          this.evidenceNotice = 'Unable to recompute evidence quality.';
          this.cdr.markForCheck();
        },
      });
  }

  updateEvidenceStatus(status: 'REVIEWED' | 'ACCEPTED' | 'REJECTED' | 'SUBMITTED') {
    if (!this.evidenceRecord?.id || this.evidenceBusy) return;

    const commentRequired = status === 'ACCEPTED' || status === 'REJECTED';
    const promptLabel =
      status === 'ACCEPTED'
        ? 'Review comment (required for Accept)'
        : status === 'REJECTED'
          ? 'Review comment (required for Reject)'
          : 'Review comment (optional)';
    const defaultComment = String(this.evidenceRecord.reviewComment || '').trim();
    const reviewComment = String(window.prompt(promptLabel, defaultComment) || '').trim();

    if (commentRequired && !reviewComment) {
      this.evidenceNotice = 'Review comment is required for Accept/Reject.';
      this.cdr.markForCheck();
      return;
    }

    this.evidenceBusy = true;
    this.evidenceNotice = '';
    this.api
      .reviewEvidence(
        this.evidenceRecord.id,
        {
          status,
          reviewComment: reviewComment || undefined,
          validFrom: this.evidenceRecord.validFrom || undefined,
          validTo: this.evidenceRecord.validTo || undefined,
          reason: `UPDATED_FROM_FILE_DETAILS_${status}`,
        },
        crypto.randomUUID(),
      )
      .subscribe({
        next: (res) => {
          this.evidenceRecord = res?.evidence || this.evidenceRecord;
          this.evidenceNotice = `Evidence updated to ${status}.`;
          this.evidenceBusy = false;
          this.refreshEvidence();
        },
        error: () => {
          this.evidenceBusy = false;
          this.evidenceNotice = 'Unable to update evidence status.';
          this.cdr.markForCheck();
        },
      });
  }

  updateEvidenceValidity() {
    if (!this.evidenceRecord?.id || this.evidenceBusy) return;
    const defaultValidFrom = this.evidenceRecord.validFrom || '';
    const defaultValidTo = this.evidenceRecord.validTo || '';
    const validFrom = String(window.prompt('Valid from (ISO date, optional)', defaultValidFrom) || '').trim();
    const validTo = String(window.prompt('Valid to (ISO date, optional)', defaultValidTo) || '').trim();

    this.evidenceBusy = true;
    this.evidenceNotice = '';
    this.api
      .reviewEvidence(
        this.evidenceRecord.id,
        {
          status: this.evidenceRecord.status,
          reviewComment: this.evidenceRecord.reviewComment || undefined,
          validFrom: validFrom || undefined,
          validTo: validTo || undefined,
          reason: 'VALIDITY_UPDATED_FROM_FILE_DETAILS',
        },
        crypto.randomUUID(),
      )
      .subscribe({
        next: (res) => {
          this.evidenceRecord = res?.evidence || this.evidenceRecord;
          this.evidenceNotice = 'Evidence validity updated.';
          this.evidenceBusy = false;
          this.refreshEvidence();
        },
        error: () => {
          this.evidenceBusy = false;
          this.evidenceNotice = 'Unable to update evidence validity.';
          this.cdr.markForCheck();
        },
      });
  }

  linkEvidenceToControl() {
    if (!this.evidenceRecord?.id || this.evidenceBusy) return;
    this.openLinkControlModal();
  }

  async createEvidenceRequest() {
    if (!this.evidenceRecord?.id || this.evidenceBusy) return;
    const linkedControl = String(
      this.evidenceRecord.links?.[0]?.controlCode ||
      this.evidenceRecord.links?.[0]?.controlId ||
      this.evidenceRecord.matchControlId ||
      '',
    ).trim();
    const controlInput = String(
      window.prompt('Control code or control ID for the evidence request', linkedControl) || '',
    ).trim();
    if (!controlInput) {
      this.evidenceNotice = 'Control code or control ID is required.';
      this.cdr.markForCheck();
      return;
    }

    const ownerIdDefault = this.auth.user()?.id || '';
    const ownerId = String(window.prompt('Owner user ID', ownerIdDefault) || '').trim();
    if (!ownerId) {
      this.evidenceNotice = 'Owner ID is required.';
      this.cdr.markForCheck();
      return;
    }

    const dueDateDefault = new Date(Date.now() + 14 * 86400000).toISOString();
    const dueDate = String(window.prompt('Due date (ISO format)', dueDateDefault) || '').trim();
    if (!dueDate) {
      this.evidenceNotice = 'Due date is required.';
      this.cdr.markForCheck();
      return;
    }

    this.evidenceBusy = true;
    this.evidenceNotice = '';
    try {
      const target = await this.resolveControlTarget(controlInput);
      if (!target) {
        this.evidenceNotice = 'Control not found. Use a valid control code (e.g. A.5.1) or control ID.';
        return;
      }

      const res = await firstValueFrom(
        this.api.createEvidenceRequest(
          {
            controlId: target.id,
            ownerId,
            dueDate,
            reason: `Created from file details evidence ${this.evidenceRecord.id}`,
          },
          crypto.randomUUID(),
        ),
      );

      this.evidenceNotice = res?.created
        ? `Evidence request created for ${target.label}.`
        : 'Evidence request already exists (deduplicated).';
    } catch {
      this.evidenceNotice = 'Unable to create evidence request.';
    } finally {
      this.evidenceBusy = false;
      this.cdr.markForCheck();
    }
  }

  runEvidenceBackfill() {
    if (!this.canManageStatus || this.evidenceBusy) return;
    this.evidenceBusy = true;
    this.evidenceNotice = 'Running backfill from uploaded files...';
    this.api.backfillEvidence().subscribe({
      next: (res) => {
        const created = Number(res?.created || 0);
        this.evidenceNotice =
          created > 0
            ? `Backfill completed. ${created} evidence item(s) created.`
            : 'Backfill completed with no new evidence rows.';
        this.evidenceBusy = false;
        this.refreshEvidence();
      },
      error: () => {
        this.evidenceBusy = false;
        this.evidenceNotice = 'Backfill failed.';
        this.cdr.markForCheck();
      },
    });
  }

  private load() {
    if (!this.uploadId) {
      this.loading = false;
      this.error = 'Invalid file identifier.';
      return;
    }

    this.loading = true;
    this.evidenceLoading = true;
    this.error = '';
    this.evidenceNotice = '';
    this.detail = null;
    this.evidenceRecord = null;
    this.evidenceQuality = null;
    this.cdr.markForCheck();

    forkJoin({
      upload: this.api.getUpload(this.uploadId),
      evidence: this.api
        .getEvidenceByDocumentId(this.uploadId)
        .pipe(catchError(() => of({ ok: false, evidence: null as EvidenceRecord | null }))),
    }).subscribe({
      next: ({ upload, evidence }) => {
        this.activeFrameworkLabel = this.formatFrameworkLabel(
          upload?.activeFramework,
          upload?.activeFrameworkVersion,
        );
        this.setDocument(upload?.document || null);
        this.setEvidence(evidence?.evidence || null);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.evidenceLoading = false;
        this.error = 'Unable to load file details.';
        this.cdr.markForCheck();
      },
    });
  }

  openLinkControlModal() {
    if (!this.evidenceRecord?.id || this.linkControlLoading || this.linkControlSaving) return;
    this.showLinkControlModal = true;
    this.linkControlError = '';
    this.linkControlQuery = '';
    this.linkControlSelectedIds = [];
    this.linkControlOptions = [];
    this.loadActiveControlsForLinking();
  }

  closeLinkControlModal() {
    if (this.linkControlSaving) return;
    this.showLinkControlModal = false;
    this.linkControlLoading = false;
    this.linkControlError = '';
    this.linkControlQuery = '';
    this.linkControlSelectedIds = [];
    this.linkControlOptions = [];
    this.cdr.markForCheck();
  }

  isLinkControlSelected(controlId: string) {
    return this.linkControlSelectedIds.includes(controlId);
  }

  toggleLinkControlSelection(controlId: string, event?: Event) {
    event?.stopPropagation();
    const option = this.linkControlOptions.find((item) => item.id === controlId);
    if (!option || option.alreadyLinked || this.linkControlSaving) return;

    if (this.linkControlSelectedIds.includes(controlId)) {
      this.linkControlSelectedIds = this.linkControlSelectedIds.filter((id) => id !== controlId);
    } else {
      this.linkControlSelectedIds = [...this.linkControlSelectedIds, controlId];
    }
  }

  async submitLinkControlSelection() {
    if (!this.evidenceRecord?.id || this.linkControlSaving) return;

    const selectedOptions = this.linkControlOptions.filter(
      (option) => this.linkControlSelectedIds.includes(option.id) && !option.alreadyLinked,
    );
    if (!selectedOptions.length) {
      this.linkControlError = 'Select at least one control to link.';
      this.cdr.markForCheck();
      return;
    }

    this.linkControlSaving = true;
    this.evidenceBusy = true;
    this.linkControlError = '';
    this.evidenceNotice = '';
    this.cdr.markForCheck();

    try {
      const results = await Promise.allSettled(
        selectedOptions.map((option) =>
          firstValueFrom(
            this.api.linkEvidenceToControl(
              {
                evidenceId: this.evidenceRecord!.id,
                controlId: option.id,
                reason: 'LINKED_FROM_FILE_DETAILS',
              },
              crypto.randomUUID(),
            ),
          ),
        ),
      );

      let linkedCount = 0;
      const failed: string[] = [];

      results.forEach((result, index) => {
        const option = selectedOptions[index];
        const label = option.controlCode || option.title || option.id;
        if (result.status === 'fulfilled') {
          if (result.value?.created !== false) {
            linkedCount += 1;
          }
          return;
        }
        failed.push(label);
      });

      if (linkedCount > 0) {
        this.evidenceNotice = `Evidence linked to ${linkedCount} control(s).`;
        this.refreshEvidence();
        this.refreshDocumentOverview();
      } else if (!failed.length) {
        this.evidenceNotice = 'Selected controls are already linked.';
      }

      if (failed.length) {
        const sample = failed.slice(0, 3).join(', ');
        this.linkControlError =
          failed.length > 3
            ? `Failed to link ${failed.length} controls (${sample}, ...).`
            : `Failed to link: ${sample}.`;
      } else {
        this.closeLinkControlModal();
      }
    } catch {
      this.linkControlError = 'Unable to link controls right now.';
    } finally {
      this.linkControlSaving = false;
      this.evidenceBusy = false;
      this.cdr.markForCheck();
    }
  }

  private setDocument(doc: UploadDocumentRecord | null) {
    if (!doc) {
      this.detail = null;
      return;
    }
    this.detail = this.mapDocument(doc);
  }

  private setEvidence(evidence: EvidenceRecord | null) {
    this.evidenceRecord = evidence;
    this.syncDetailControlFromEvidence();
    if (!evidence?.id) {
      this.evidenceQuality = null;
      this.evidenceLoading = false;
      return;
    }
    this.fetchEvidenceQuality(evidence.id);
  }

  private fetchEvidenceQuality(evidenceId: string) {
    this.evidenceLoading = true;
    this.api.getEvidenceQuality(evidenceId).subscribe({
      next: (res) => {
        this.evidenceQuality = res?.quality || null;
        this.evidenceLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.evidenceQuality = null;
        this.evidenceLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  refreshEvidence() {
    if (!this.uploadId) return;
    this.evidenceLoading = true;
    this.api
      .getEvidenceByDocumentId(this.uploadId)
      .pipe(catchError(() => of({ ok: false, evidence: null as EvidenceRecord | null })))
      .subscribe({
        next: (res) => {
          this.setEvidence(res?.evidence || null);
          this.cdr.markForCheck();
        },
        error: () => {
          this.evidenceLoading = false;
          this.cdr.markForCheck();
        },
      });
  }

  private refreshDocumentOverview() {
    if (!this.uploadId) return;
    this.api
      .getUpload(this.uploadId)
      .pipe(catchError(() => of(null)))
      .subscribe({
        next: (res) => {
          this.setDocument(res?.document || null);
          this.cdr.markForCheck();
        },
        error: () => {
          this.cdr.markForCheck();
        },
      });
  }

  private loadActiveControlsForLinking() {
    if (!this.evidenceRecord) return;
    this.linkControlLoading = true;
    this.linkControlError = '';
    this.cdr.markForCheck();

    const linkedControlIds = new Set(
      (this.evidenceRecord.links || [])
        .map((link) => String(link.controlId || '').trim())
        .filter(Boolean),
    );

    this.api
      .listControlDefinitions({
        status: 'enabled',
        page: 1,
        pageSize: 500,
      })
      .pipe(catchError(() => of({ items: [] as ControlDefinitionRecord[] })))
      .subscribe({
        next: (res) => {
          const items = Array.isArray(res?.items) ? res.items : [];
          const unique = new Map<string, LinkControlOption>();
          for (const control of items) {
            const id = String(control?.id || '').trim();
            if (!id || unique.has(id)) continue;
            const controlCode = String(control?.controlCode || '').trim();
            const title = String(control?.title || '').trim() || controlCode || id;
            unique.set(id, {
              id,
              controlCode,
              title,
              alreadyLinked: linkedControlIds.has(id),
            });
          }

          this.linkControlOptions = Array.from(unique.values()).sort((a, b) =>
            `${a.controlCode} ${a.title}`.localeCompare(`${b.controlCode} ${b.title}`),
          );
          if (!this.linkControlOptions.length) {
            this.linkControlError = 'No active controls found.';
          }
          this.linkControlLoading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.linkControlLoading = false;
          this.linkControlError = 'Unable to load active controls.';
          this.cdr.markForCheck();
        },
      });
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
      detailsTitle: this.resolveDetailsTitle(doc, references),
      mimeType: String(doc.mimeType || 'Unknown'),
      sizeLabel: this.formatSize(doc.sizeBytes ?? 0),
      sizeBytes: Number(doc.sizeBytes ?? 0),
      framework: this.resolveFrameworkLabel(doc, this.activeFrameworkLabel),
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
      analysisInsights: doc.analysisJson || null,
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

  private resolveFrameworkLabel(doc: UploadDocumentRecord, activeFrameworkLabel: string) {
    const normalizedFramework = String(activeFrameworkLabel || '').trim();
    if (normalizedFramework) return normalizedFramework;
    const firstRef = Array.isArray(doc.frameworkReferences) ? doc.frameworkReferences[0] : '';
    if (String(firstRef || '').trim()) return `Ref ${firstRef}`;
    return '—';
  }

  private resolveDetailsTitle(doc: UploadDocumentRecord, references: string[]) {
    const hasControl = String(doc.matchControlId || '').trim().length > 0;
    if (hasControl || references.length) return 'Control & Reference Details';
    const docType = String(doc.docType || '').trim();
    if (docType && docType.toLowerCase() !== 'uncategorized') return `${docType} Details`;
    return 'File Details';
  }

  private formatFrameworkLabel(name?: string | null, version?: string | null) {
    const frameworkName = String(name || '').trim();
    const frameworkVersion = String(version || '').trim();
    if (!frameworkName && !frameworkVersion) return '';
    if (!frameworkVersion) return frameworkName;
    if (!frameworkName) return frameworkVersion;
    if (frameworkName.toLowerCase().includes(frameworkVersion.toLowerCase())) return frameworkName;
    return `${frameworkName} ${frameworkVersion}`.trim();
  }

  private findBestControlMatch(
    controls: ControlDefinitionRecord[],
    controlCode: string,
    frameworkReferences: string[],
    frameworkLabel: string,
  ) {
    const targetCode = this.normalizeToken(controlCode);
    const exactMatches = controls.filter(
      (control) => this.normalizeToken(String(control?.controlCode || '')) === targetCode,
    );
    if (!exactMatches.length) return null;
    if (exactMatches.length === 1) return exactMatches[0];

    const normalizedRefs = new Set(
      frameworkReferences
        .map((value) => this.normalizeToken(value))
        .filter(Boolean),
    );
    if (normalizedRefs.size) {
      const byReference = exactMatches.find((control) =>
        (control.frameworkMappings || []).some((mapping) =>
          normalizedRefs.has(this.normalizeToken(String(mapping.frameworkCode || ''))),
        ),
      );
      if (byReference) return byReference;
    }

    const normalizedFramework = this.normalizeToken(frameworkLabel);
    if (normalizedFramework) {
      const byFramework = exactMatches.find((control) =>
        (control.frameworkMappings || []).some((mapping) => {
          const token = this.normalizeToken(String(mapping.framework || ''));
          return !!token && (token.includes(normalizedFramework) || normalizedFramework.includes(token));
        }),
      );
      if (byFramework) return byFramework;
    }

    return exactMatches[0];
  }

  private async resolveControlTarget(input: string): Promise<{ id: string; label: string } | null> {
    const token = String(input || '').trim();
    if (!token) return null;

    const direct = await firstValueFrom(
      this.api
        .getControlDefinition(token)
        .pipe(catchError(() => of(null as unknown as ControlDefinitionRecord | null))),
    );
    if (direct?.id) {
      return {
        id: direct.id,
        label: String(direct.controlCode || direct.title || direct.id),
      };
    }

    const list = await firstValueFrom(
      this.api
        .listControlDefinitions({
          query: token,
          page: 1,
          pageSize: 100,
        })
        .pipe(catchError(() => of({ items: [] as ControlDefinitionRecord[] }))),
    );

    const items = Array.isArray(list?.items) ? list.items : [];
    if (!items.length) return null;

    const normalized = this.normalizeToken(token);
    const exactId = items.find(
      (control) => this.normalizeToken(String(control?.id || '')) === normalized,
    );
    if (exactId?.id) {
      return {
        id: exactId.id,
        label: String(exactId.controlCode || exactId.title || exactId.id),
      };
    }

    const exactCode = items.filter(
      (control) => this.normalizeToken(String(control?.controlCode || '')) === normalized,
    );

    let matched: ControlDefinitionRecord | null = null;
    if (exactCode.length === 1) {
      matched = exactCode[0];
    } else if (exactCode.length > 1) {
      matched = this.findBestControlMatch(
        exactCode,
        token,
        this.detail?.frameworkReferences || [],
        this.detail?.framework || '',
      );
    } else {
      matched =
        this.findBestControlMatch(
          items,
          token,
          this.detail?.frameworkReferences || [],
          this.detail?.framework || '',
        ) || null;
    }

    const resolved = matched || items[0];
    if (!resolved?.id) return null;
    return {
      id: resolved.id,
      label: String(resolved.controlCode || resolved.title || resolved.id),
    };
  }

  private normalizeToken(value?: string | null) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private getLinkedControlCodesFromEvidence() {
    const links = Array.isArray(this.evidenceRecord?.links) ? this.evidenceRecord?.links : [];
    const values = links
      .map((link) => String(link.controlCode || link.controlId || '').trim())
      .filter(Boolean);
    return Array.from(new Set(values));
  }

  private syncDetailControlFromEvidence() {
    if (!this.detail) return;
    const current = String(this.detail.controlCode || '').trim();
    if (current) return;

    const linkedCodes = this.getLinkedControlCodesFromEvidence();
    if (!linkedCodes.length) return;

    this.detail = {
      ...this.detail,
      controlCode: linkedCodes[0],
    };
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

  barPercent(points: number, max: number) {
    if (!max) return 0;
    return Math.round((points / max) * 100);
  }
}
