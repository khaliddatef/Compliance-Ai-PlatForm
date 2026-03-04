import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, Subscription } from 'rxjs';
import {
  ApiService,
  EvidenceQualityPayload,
  EvidenceRecord,
  EvidenceRequestRecord,
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { UploadDropzoneComponent } from '../../components/upload-dropzone/upload-dropzone.component';

type HubTab = 'inbox' | 'evidence' | 'requests';
type EvidencePreset = 'all' | 'pending' | 'expiring' | 'unlinked' | 'weak' | 'expired';
type EvidenceViewMode = 'table' | 'byControl';

type EvidenceDetailRecord = EvidenceRecord & {
  links?: Array<{
    id: string;
    controlId: string;
    controlCode?: string | null;
    controlTitle?: string | null;
    linkedById?: string | null;
    createdAt?: string | null;
  }>;
};

@Component({
  selector: 'app-evidence-page',
  standalone: true,
  imports: [CommonModule, FormsModule, UploadDropzoneComponent],
  templateUrl: './evidence-page.component.html',
  styleUrl: './evidence-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EvidencePageComponent implements OnInit, OnDestroy {
  loadingEvidence = true;
  loadingRequests = false;
  detailLoading = false;
  actionBusy = false;

  error = '';
  notice = '';
  uploadError = '';
  uploadNotice = '';
  uploading = false;
  showUploadPanel = false;

  activeTab: HubTab = 'inbox';
  viewMode: EvidenceViewMode = 'table';

  search = '';
  mobileSearchExpanded = false;
  mobileFiltersExpanded = false;
  statusFilter = 'all';
  qualityFilter: 'all' | 'WEAK' | 'MEDIUM' | 'STRONG' = 'all';
  sourceFilter = 'all';
  showExpiringSoonOnly = false;
  presetFilter: EvidencePreset = 'all';

  requestSearch = '';
  requestStatusFilter: 'all' | 'OPEN' | 'SUBMITTED' | 'OVERDUE' | 'CLOSED' = 'all';

  evidence: EvidenceRecord[] = [];
  requests: EvidenceRequestRecord[] = [];
  selectedEvidence: EvidenceDetailRecord | null = null;
  selectedQuality: EvidenceQualityPayload | null = null;

  private readonly bucketIds = {
    pending: new Set<string>(),
    expiring: new Set<string>(),
    overdue: new Set<string>(),
  };

  private attemptedAutoBackfill = false;
  private routeSub?: Subscription;

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const next = this.normalizeTab(params.get('tab'));
      this.setTab(next, false);
    });
    this.refresh();
  }

  ngOnDestroy() {
    this.routeSub?.unsubscribe();
  }

  get canManageEvidence() {
    const role = (this.auth.user()?.role || 'USER').toUpperCase();
    return role === 'ADMIN' || role === 'MANAGER';
  }

  get pendingCount() {
    return this.bucketIds.pending.size;
  }

  get expiringCount() {
    return this.bucketIds.expiring.size;
  }

  get overdueCount() {
    return this.visibleOverdueRequests.length;
  }

  get unlinkedCount() {
    return this.evidence.filter((item) => (item.linksCount || 0) === 0).length;
  }

  get weakCount() {
    return this.evidence.filter((item) => this.isWeak(item)).length;
  }

  get expiredCount() {
    return this.evidence.filter((item) => this.isExpired(item)).length;
  }

  get visibleEvidence() {
    const q = this.search.trim().toLowerCase();
    let rows = [...this.evidence];

    if (this.activeTab === 'inbox') {
      rows = rows.filter((item) => this.matchesPreset(item, this.presetFilter));
    }

    if (q) {
      rows = rows.filter((item) => {
        const hay = [
          item.title,
          item.type,
          item.source,
          item.status,
          item.qualityGrade || '',
          item.createdByName || '',
          item.reviewedById || '',
          item.matchControlId || '',
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (this.statusFilter !== 'all') {
      rows = rows.filter((item) => item.status === this.statusFilter);
    }

    if (this.qualityFilter !== 'all') {
      rows = rows.filter((item) => String(item.qualityGrade || '') === this.qualityFilter);
    }

    if (this.sourceFilter !== 'all') {
      rows = rows.filter((item) => String(item.source || '').toLowerCase() === this.sourceFilter);
    }

    if (this.showExpiringSoonOnly) {
      rows = rows.filter((item) => this.isExpiringSoon(item));
    }

    return rows.sort((a, b) => this.compareEvidenceRows(a, b));
  }

  get showMobileSearchInput() {
    return this.mobileSearchExpanded || !!this.search.trim();
  }

  get groupedEvidence() {
    const groups = new Map<string, EvidenceRecord[]>();
    for (const row of this.visibleEvidence) {
      const key = String(row.matchControlId || '').trim() || 'UNLINKED';
      const existing = groups.get(key) || [];
      existing.push(row);
      groups.set(key, existing);
    }

    return Array.from(groups.entries())
      .map(([key, items]) => ({
        key,
        label: key === 'UNLINKED' ? 'Unlinked evidence' : `Control ${key}`,
        items,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  get visibleRequests() {
    const q = this.requestSearch.trim().toLowerCase();
    let rows = [...this.requests];

    if (this.requestStatusFilter !== 'all') {
      rows = rows.filter((item) => item.status === this.requestStatusFilter);
    }

    if (q) {
      rows = rows.filter((item) => {
        const hay = [
          item.controlCode || '',
          item.controlTitle || '',
          item.ownerName || '',
          item.ownerId,
          item.status,
          item.testComponentRequirement || '',
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    return rows.sort((a, b) => {
      if (a.status === 'OVERDUE' && b.status !== 'OVERDUE') return -1;
      if (b.status === 'OVERDUE' && a.status !== 'OVERDUE') return 1;
      const aTime = this.toDate(a.dueDate)?.getTime() || 0;
      const bTime = this.toDate(b.dueDate)?.getTime() || 0;
      return aTime - bTime;
    });
  }

  get visibleOverdueRequests() {
    return this.requests.filter((item) => item.status === 'OVERDUE');
  }

  get qualityBreakdownRows() {
    const factors = this.selectedQuality?.factors;
    if (!factors) return [];
    return [
      {
        key: 'Relevance',
        points: factors.relevance.points,
        max: factors.relevance.max,
      },
      {
        key: 'Reliability',
        points: factors.reliability.points,
        max: factors.reliability.max,
      },
      {
        key: 'Freshness',
        points: factors.freshness.points,
        max: factors.freshness.max,
      },
      {
        key: 'Completeness',
        points: factors.completeness.points,
        max: factors.completeness.max,
      },
    ];
  }

  get topReasons() {
    return (this.selectedQuality?.factors?.reasons || []).slice(0, 3);
  }

  get fixActions() {
    return (this.selectedQuality?.factors?.fixes || []).slice(0, 3);
  }

  get selectedGradeClass() {
    const grade = this.selectedQuality?.grade || this.selectedEvidence?.qualityGrade || '';
    if (grade === 'STRONG') return 'grade-strong';
    if (grade === 'MEDIUM') return 'grade-medium';
    return 'grade-weak';
  }

  get selectedChecklist() {
    if (!this.selectedEvidence) return [];
    const status = String(this.selectedEvidence.status || '').toUpperCase();
    return [
      {
        label: 'Link to control',
        done: (this.selectedEvidence.links?.length || this.selectedEvidence.linksCount || 0) > 0,
      },
      {
        label: 'Review evidence',
        done: status === 'REVIEWED' || status === 'ACCEPTED' || status === 'REJECTED',
      },
      {
        label: 'Set expiry',
        done: Boolean(this.selectedEvidence.validTo),
      },
    ];
  }

  refresh() {
    this.error = '';
    this.notice = '';
    this.attemptedAutoBackfill = false;
    this.loadEvidence();
    this.loadInboxBuckets();
    if (this.activeTab === 'requests' || this.requests.length) {
      this.loadRequests();
    }
  }

  setTab(tab: HubTab, syncRoute = true) {
    if (tab === this.activeTab) {
      if (tab === 'requests' && !this.requests.length && !this.loadingRequests) {
        this.loadRequests();
      }
      return;
    }

    this.activeTab = tab;
    this.notice = '';

    if (this.activeTab === 'requests' && !this.requests.length) {
      this.loadRequests();
    }

    if (syncRoute) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { tab },
        queryParamsHandling: 'merge',
      });
    }

    this.cdr.markForCheck();
  }

  setPreset(preset: EvidencePreset) {
    this.presetFilter = preset;
  }

  toggleMobileSearch() {
    this.mobileSearchExpanded = !this.mobileSearchExpanded;
  }

  toggleMobileFilters() {
    this.mobileFiltersExpanded = !this.mobileFiltersExpanded;
  }

  setViewMode(mode: EvidenceViewMode) {
    this.viewMode = mode;
  }

  toggleUploadPanel() {
    if (!this.canManageEvidence) return;
    this.showUploadPanel = !this.showUploadPanel;
  }

  closeUploadPanel() {
    this.showUploadPanel = false;
  }

  handleManagerUpload(files: File[]) {
    if (!this.canManageEvidence || this.uploading) return;
    const cleanFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!cleanFiles.length) return;

    const userId = this.auth.user()?.id || '';
    const conversationId = userId ? `evidence-hub-${userId}` : crypto.randomUUID();
    const language = this.getPreferredLanguage();

    this.uploading = true;
    this.uploadError = '';
    this.uploadNotice = 'Uploading files...';
    this.cdr.markForCheck();

    this.api.uploadCustomerFiles(conversationId, cleanFiles, language).subscribe({
      next: (res) => {
        const docs = Array.isArray(res?.documents) ? res.documents : [];
        const count = docs.length || res?.count || cleanFiles.length;
        this.uploadNotice = `Uploaded ${count} file${count === 1 ? '' : 's'} successfully.`;
        this.uploading = false;
        this.showUploadPanel = false;
        this.setTab('inbox');
        this.refresh();
      },
      error: () => {
        this.uploadError = 'Unable to upload files right now.';
        this.uploadNotice = '';
        this.uploading = false;
        this.cdr.markForCheck();
      },
    });
  }

  openDetail(record: EvidenceRecord) {
    this.selectedEvidence = null;
    this.selectedQuality = null;
    this.detailLoading = true;
    this.notice = '';
    this.cdr.markForCheck();

    forkJoin({
      evidence: this.api.getEvidence(record.id),
      quality: this.api.getEvidenceQuality(record.id),
    }).subscribe({
      next: ({ evidence, quality }) => {
        this.selectedEvidence = evidence?.evidence || null;
        this.selectedQuality = quality?.quality || null;
        this.detailLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.detailLoading = false;
        this.notice = 'Unable to load evidence details.';
        this.cdr.markForCheck();
      },
    });
  }

  closeDetail() {
    this.selectedEvidence = null;
    this.selectedQuality = null;
  }

  openUploadDetail(record: EvidenceRecord, event?: MouseEvent) {
    event?.stopPropagation();
    const documentId = String(record.documentId || '').trim();
    if (!documentId) return;
    this.router.navigate(['/uploads', documentId]);
  }

  recomputeSelectedQuality() {
    if (!this.selectedEvidence?.id || this.actionBusy) return;
    this.actionBusy = true;
    this.notice = '';

    this.api
      .recomputeEvidenceQuality(
        this.selectedEvidence.id,
        { reason: 'MANUAL_RECOMPUTE_FROM_HUB', force: true },
        crypto.randomUUID(),
      )
      .subscribe({
        next: (res) => {
          this.selectedQuality = res?.quality || null;
          this.notice = res?.replayed
            ? 'Recompute replayed from idempotency cache.'
            : 'Quality recomputed.';
          this.refreshRowQuality(this.selectedEvidence?.id || '', this.selectedQuality);
        },
        error: () => {
          this.notice = 'Unable to recompute quality.';
        },
        complete: () => {
          this.actionBusy = false;
          this.cdr.markForCheck();
        },
      });
  }

  reviewSelected(status: 'REVIEWED' | 'ACCEPTED' | 'REJECTED' | 'SUBMITTED') {
    if (!this.selectedEvidence?.id || this.actionBusy) return;

    const commentRequired = status === 'ACCEPTED' || status === 'REJECTED';
    const promptLabel =
      status === 'ACCEPTED'
        ? 'Review comment (required for Accept)'
        : status === 'REJECTED'
          ? 'Review comment (required for Reject)'
          : 'Review comment (optional)';
    const defaultComment = String(this.selectedEvidence.reviewComment || '').trim();
    const reviewComment = String(window.prompt(promptLabel, defaultComment) || '').trim();

    if (commentRequired && !reviewComment) {
      this.notice = 'Review comment is required for Accept/Reject.';
      this.cdr.markForCheck();
      return;
    }

    this.actionBusy = true;
    this.notice = '';

    this.api
      .reviewEvidence(
        this.selectedEvidence.id,
        {
          status,
          reviewComment: reviewComment || undefined,
          validFrom: this.selectedEvidence.validFrom || undefined,
          validTo: this.selectedEvidence.validTo || undefined,
          reason: `UPDATED_FROM_EVIDENCE_HUB_${status}`,
        },
        crypto.randomUUID(),
      )
      .subscribe({
        next: (res) => {
          const updated = res?.evidence || null;
          if (updated) {
            this.selectedEvidence = {
              ...this.selectedEvidence,
              ...updated,
            };
            this.upsertEvidenceRow(updated);
          }
          this.notice = `Evidence updated to ${status}.`;
          this.actionBusy = false;
          if (this.selectedEvidence?.id) {
            this.openDetail(this.selectedEvidence);
          }
          this.refresh();
        },
        error: () => {
          this.notice = 'Unable to update review status.';
          this.actionBusy = false;
          this.cdr.markForCheck();
        },
      });
  }

  updateSelectedValidity() {
    if (!this.selectedEvidence?.id || this.actionBusy) return;

    const defaultValidFrom = this.selectedEvidence.validFrom || '';
    const defaultValidTo = this.selectedEvidence.validTo || '';
    const validFrom = String(window.prompt('Valid from (ISO date, optional)', defaultValidFrom) || '').trim();
    const validTo = String(window.prompt('Valid to (ISO date, optional)', defaultValidTo) || '').trim();

    this.actionBusy = true;
    this.notice = '';

    this.api
      .reviewEvidence(
        this.selectedEvidence.id,
        {
          status: this.selectedEvidence.status,
          reviewComment: this.selectedEvidence.reviewComment || undefined,
          validFrom: validFrom || undefined,
          validTo: validTo || undefined,
          reason: 'VALIDITY_UPDATED_FROM_EVIDENCE_HUB',
        },
        crypto.randomUUID(),
      )
      .subscribe({
        next: (res) => {
          const updated = res?.evidence || null;
          if (updated) {
            this.selectedEvidence = {
              ...this.selectedEvidence,
              ...updated,
            };
            this.upsertEvidenceRow(updated);
          }
          this.notice = 'Evidence validity updated.';
          this.actionBusy = false;
          if (this.selectedEvidence?.id) {
            this.openDetail(this.selectedEvidence);
          }
          this.refresh();
        },
        error: () => {
          this.notice = 'Unable to update validity.';
          this.actionBusy = false;
          this.cdr.markForCheck();
        },
      });
  }

  linkSelectedToControl() {
    if (!this.selectedEvidence?.id || this.actionBusy) return;
    const existingControl = String(
      this.selectedEvidence.links?.[0]?.controlId || this.selectedEvidence.matchControlId || '',
    ).trim();
    const controlId = String(window.prompt('Control ID to link', existingControl) || '').trim();
    if (!controlId) return;

    this.actionBusy = true;
    this.notice = '';

    this.api
      .linkEvidenceToControl(
        {
          evidenceId: this.selectedEvidence.id,
          controlId,
          reason: 'LINKED_FROM_EVIDENCE_HUB',
        },
        crypto.randomUUID(),
      )
      .subscribe({
        next: () => {
          this.notice = 'Evidence linked to control.';
          if (this.selectedEvidence?.id) {
            this.openDetail(this.selectedEvidence);
          }
          this.refresh();
        },
        error: () => {
          this.notice = 'Unable to link evidence to control.';
        },
        complete: () => {
          this.actionBusy = false;
          this.cdr.markForCheck();
        },
      });
  }

  createRequestFromSelected() {
    if (!this.selectedEvidence?.id || this.actionBusy) return;
    const linkedControl = String(
      this.selectedEvidence.links?.[0]?.controlId || this.selectedEvidence.matchControlId || '',
    ).trim();
    const controlId = String(window.prompt('Control ID for the evidence request', linkedControl) || '').trim();
    if (!controlId) {
      this.notice = 'Control ID is required.';
      this.cdr.markForCheck();
      return;
    }

    const ownerIdDefault = this.auth.user()?.id || '';
    const ownerId = String(window.prompt('Owner user ID', ownerIdDefault) || '').trim();
    if (!ownerId) {
      this.notice = 'Owner ID is required.';
      this.cdr.markForCheck();
      return;
    }

    const dueDateDefault = new Date(Date.now() + 14 * 86400000).toISOString();
    const dueDate = String(window.prompt('Due date (ISO format)', dueDateDefault) || '').trim();
    if (!dueDate) {
      this.notice = 'Due date is required.';
      this.cdr.markForCheck();
      return;
    }

    this.actionBusy = true;
    this.notice = '';

    this.api
      .createEvidenceRequest(
        {
          controlId,
          ownerId,
          dueDate,
          reason: `Created from evidence ${this.selectedEvidence.id}`,
        },
        crypto.randomUUID(),
      )
      .subscribe({
        next: (res) => {
          this.notice = res?.created
            ? 'Evidence request created.'
            : 'Evidence request already exists (deduplicated).';
          this.loadRequests();
          this.loadInboxBuckets();
          this.setTab('requests');
        },
        error: () => {
          this.notice = 'Unable to create evidence request.';
        },
        complete: () => {
          this.actionBusy = false;
          this.cdr.markForCheck();
        },
      });
  }

  createRequestQuick() {
    if (!this.canManageEvidence || this.actionBusy) return;

    const controlId = String(window.prompt('Control ID') || '').trim();
    if (!controlId) return;

    const ownerIdDefault = this.auth.user()?.id || '';
    const ownerId = String(window.prompt('Owner user ID', ownerIdDefault) || '').trim();
    if (!ownerId) return;

    const dueDateDefault = new Date(Date.now() + 14 * 86400000).toISOString();
    const dueDate = String(window.prompt('Due date (ISO format)', dueDateDefault) || '').trim();
    if (!dueDate) return;

    this.actionBusy = true;
    this.notice = '';

    this.api
      .createEvidenceRequest(
        {
          controlId,
          ownerId,
          dueDate,
          reason: 'Created from Evidence Hub Requests tab',
        },
        crypto.randomUUID(),
      )
      .subscribe({
        next: (res) => {
          this.notice = res?.created
            ? 'Evidence request created.'
            : 'Evidence request already exists (deduplicated).';
          this.loadRequests();
          this.loadInboxBuckets();
        },
        error: () => {
          this.notice = 'Unable to create request.';
        },
        complete: () => {
          this.actionBusy = false;
          this.cdr.markForCheck();
        },
      });
  }

  fulfillRequest(request: EvidenceRequestRecord) {
    if (!request?.id || this.actionBusy) return;

    const defaultEvidenceId = this.selectedEvidence?.id || '';
    const evidenceId = String(window.prompt('Evidence ID to fulfill this request', defaultEvidenceId) || '').trim();
    if (!evidenceId) return;

    this.actionBusy = true;
    this.notice = '';

    this.api.fulfillEvidenceRequest(request.id, { evidenceId }, crypto.randomUUID()).subscribe({
      next: () => {
        this.notice = 'Request updated successfully.';
        this.loadRequests();
        this.refresh();
      },
      error: () => {
        this.notice = 'Unable to fulfill request.';
      },
      complete: () => {
        this.actionBusy = false;
        this.cdr.markForCheck();
      },
    });
  }

  openControl(controlId: string) {
    const id = String(controlId || '').trim();
    if (!id) return;
    this.router.navigate(['/control-kb', id]);
  }

  downloadSelectedEvidence() {
    if (!this.selectedEvidence) return;
    this.downloadEvidence(this.selectedEvidence);
  }

  deleteSelectedEvidence() {
    if (!this.selectedEvidence?.documentId || this.actionBusy) return;
    const name = this.selectedEvidence.title || 'this file';
    const proceed = window.confirm(`Delete ${name}?`);
    if (!proceed) return;

    this.actionBusy = true;
    this.notice = '';

    this.api.deleteUpload(this.selectedEvidence.documentId).subscribe({
      next: () => {
        this.notice = 'Evidence file deleted.';
        this.closeDetail();
        this.refresh();
      },
      error: () => {
        this.notice = 'Unable to delete this evidence file.';
      },
      complete: () => {
        this.actionBusy = false;
        this.cdr.markForCheck();
      },
    });
  }

  qualityBadge(record: EvidenceRecord) {
    const score = record.qualityScore;
    const grade = record.qualityGrade || 'WEAK';
    if (score === null || score === undefined) return '—';
    const title = grade === 'STRONG' ? 'Strong' : grade === 'MEDIUM' ? 'Medium' : 'Weak';
    return `${score} ${title}`;
  }

  qualityClass(record: EvidenceRecord) {
    if (record.qualityGrade === 'STRONG') return 'quality-strong';
    if (record.qualityGrade === 'MEDIUM') return 'quality-medium';
    if (record.qualityGrade === 'WEAK') return 'quality-weak';
    return 'quality-none';
  }

  statusClass(record: EvidenceRecord) {
    const status = String(record.status || '').toUpperCase();
    if (status === 'ACCEPTED') return 'status-accepted';
    if (status === 'REJECTED') return 'status-rejected';
    if (status === 'REVIEWED') return 'status-reviewed';
    return 'status-submitted';
  }

  requestStatusClass(request: EvidenceRequestRecord) {
    const status = String(request.status || '').toUpperCase();
    if (status === 'CLOSED') return 'request-closed';
    if (status === 'OVERDUE') return 'request-overdue';
    if (status === 'SUBMITTED') return 'request-submitted';
    return 'request-open';
  }

  isExpired(record: EvidenceRecord) {
    const validTo = this.toDate(record.validTo);
    if (!validTo) return false;
    return validTo.getTime() < Date.now();
  }

  isExpiringSoon(record: EvidenceRecord) {
    const validTo = this.toDate(record.validTo);
    if (!validTo) return false;
    const now = Date.now();
    const horizon = now + 30 * 86400000;
    return validTo.getTime() >= now && validTo.getTime() <= horizon;
  }

  isWeak(record: EvidenceRecord) {
    if (String(record.qualityGrade || '').toUpperCase() === 'WEAK') return true;
    if (typeof record.qualityScore === 'number' && record.qualityScore < 50) return true;
    return false;
  }

  trackByEvidenceId(_: number, item: EvidenceRecord) {
    return item.id;
  }

  trackByRequestId(_: number, item: EvidenceRequestRecord) {
    return item.id;
  }

  barPercent(points: number, max: number) {
    if (!max) return 0;
    return Math.round((points / max) * 100);
  }

  private loadEvidence() {
    this.loadingEvidence = true;
    this.api.listEvidence({ page: 1, pageSize: 300 }).subscribe({
      next: (res) => {
        const items = Array.isArray(res?.items) ? res.items : [];
        this.evidence = items;
        this.loadingEvidence = false;
        if (!items.length && this.canManageEvidence && !this.attemptedAutoBackfill) {
          this.tryAutoBackfill();
          return;
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingEvidence = false;
        this.error = 'Unable to load evidence records right now.';
        this.cdr.markForCheck();
      },
    });
  }

  private tryAutoBackfill() {
    if (this.attemptedAutoBackfill || !this.canManageEvidence) {
      this.cdr.markForCheck();
      return;
    }
    this.attemptedAutoBackfill = true;
    this.notice = 'No evidence found. Running one-time backfill from uploaded files...';
    this.cdr.markForCheck();

    this.api.backfillEvidence().subscribe({
      next: (res) => {
        const created = Number(res?.created || 0);
        const scanned = Number(res?.scanned || 0);
        this.notice =
          created > 0
            ? `Backfill completed: ${created} evidence item(s) created from ${scanned} uploaded file(s).`
            : 'Backfill ran successfully, but no new evidence rows were created.';
        this.loadEvidence();
        this.loadInboxBuckets();
      },
      error: () => {
        this.notice = 'Backfill could not run automatically. Please verify backend DB and permissions.';
        this.cdr.markForCheck();
      },
    });
  }

  private loadRequests() {
    this.loadingRequests = true;
    this.api.listEvidenceRequests({ page: 1, pageSize: 300 }).subscribe({
      next: (res) => {
        this.requests = Array.isArray(res?.items) ? res.items : [];
        this.loadingRequests = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingRequests = false;
        this.error = 'Unable to load evidence requests right now.';
        this.cdr.markForCheck();
      },
    });
  }

  private loadInboxBuckets() {
    forkJoin({
      pending: this.api.getEvidenceReviewInbox('pending'),
      expiring: this.api.getEvidenceReviewInbox('expiring'),
      overdue: this.api.getEvidenceReviewInbox('overdue'),
    }).subscribe({
      next: ({ pending, expiring, overdue }) => {
        this.bucketIds.pending = new Set((pending?.items || []).map((item: any) => String(item?.id || '')));
        this.bucketIds.expiring = new Set((expiring?.items || []).map((item: any) => String(item?.id || '')));
        this.bucketIds.overdue = new Set((overdue?.items || []).map((item: any) => String(item?.id || '')));
        this.cdr.markForCheck();
      },
    });
  }

  private normalizeTab(value: string | null): HubTab {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'requests') return 'requests';
    if (normalized === 'evidence') return 'evidence';
    return 'inbox';
  }

  private matchesPreset(item: EvidenceRecord, preset: EvidencePreset) {
    if (preset === 'all') return true;
    if (preset === 'pending') return this.bucketIds.pending.has(item.id);
    if (preset === 'expiring') return this.bucketIds.expiring.has(item.id) || this.isExpiringSoon(item);
    if (preset === 'unlinked') return (item.linksCount || 0) === 0;
    if (preset === 'weak') return this.isWeak(item);
    if (preset === 'expired') return this.isExpired(item);
    return true;
  }

  private compareEvidenceRows(a: EvidenceRecord, b: EvidenceRecord) {
    const aTime = this.toDate(a.createdAt)?.getTime() || 0;
    const bTime = this.toDate(b.createdAt)?.getTime() || 0;

    if (this.activeTab !== 'inbox') {
      return bTime - aTime;
    }

    const priority = (item: EvidenceRecord) => {
      if (this.bucketIds.pending.has(item.id)) return 0;
      if (this.isExpired(item)) return 1;
      if (this.isWeak(item)) return 2;
      if (this.bucketIds.expiring.has(item.id) || this.isExpiringSoon(item)) return 3;
      if ((item.linksCount || 0) === 0) return 4;
      return 5;
    };

    const diff = priority(a) - priority(b);
    if (diff !== 0) return diff;
    return bTime - aTime;
  }

  private upsertEvidenceRow(next: EvidenceRecord) {
    this.evidence = this.evidence.map((item) => (item.id === next.id ? { ...item, ...next } : item));
  }

  private refreshRowQuality(evidenceId: string, quality: EvidenceQualityPayload | null) {
    if (!evidenceId || !quality) return;
    this.evidence = this.evidence.map((item) =>
      item.id === evidenceId
        ? {
            ...item,
            qualityScore: quality.score,
            qualityGrade: quality.grade,
            qualityFactors: quality.factors,
            qualityComputedAt: quality.computedAt,
            qualityVersion: quality.version,
          }
        : item,
    );
  }

  private downloadEvidence(record: EvidenceRecord) {
    const documentId = String(record.documentId || '').trim();
    if (documentId) {
      this.api.downloadUpload(documentId).subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = record.title || 'evidence';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
        },
        error: () => {
          this.notice = 'Unable to download this evidence file.';
          this.cdr.markForCheck();
        },
      });
      return;
    }

    if (record.url) {
      window.open(record.url, '_blank', 'noopener');
      return;
    }

    this.notice = 'No downloadable source available for this evidence.';
    this.cdr.markForCheck();
  }

  private toDate(value?: string | null) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  private getPreferredLanguage(): 'ar' | 'en' {
    if (typeof navigator === 'undefined') return 'en';
    const lang = String(navigator.language || '').toLowerCase();
    return lang.startsWith('ar') ? 'ar' : 'en';
  }
}
