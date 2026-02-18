import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, UploadDocumentRecord } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { UploadDropzoneComponent } from '../../components/upload-dropzone/upload-dropzone.component';

type UploadRow = {
  id: string;
  name: string;
  framework: string;
  frameworkReferences: string[];
  status: string;
  statusCode: 'UPLOADED' | 'REVIEWED' | 'READY' | 'SUBMITTED';
  size: string;
  sizeBytes: number;
  uploadedAt: number;
  chatTitle?: string;
  uploaderLabel?: string;
  statusClass: string;
  matchStatus?: string | null;
};

type ComplianceStatus = 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN';

@Component({
  selector: 'app-uploads-page',
  standalone: true,
  imports: [CommonModule, FormsModule, UploadDropzoneComponent],
  templateUrl: './uploads-page.component.html',
  styleUrl: './uploads-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadsPageComponent implements OnInit {
  files: UploadRow[] = [];
  loading = true;
  error = '';
  uploadError = '';
  uploadNotice = '';
  uploading = false;
  searchTerm = '';
  frameworkFilter = 'all';
  statusFilter = 'all';
  sortMode = 'recent';
  currentPage = 1;
  pageSize = 10;
  readonly pageSizeOptions = [10, 25, 50, 100];
  activeFramework = '';
  openMenuId: string | null = null;
  openComplianceMenuId: string | null = null;
  showUploadPanel = false;
  readonly complianceOptions: ComplianceStatus[] = ['COMPLIANT', 'PARTIAL', 'NOT_COMPLIANT', 'UNKNOWN'];

  constructor(
    private readonly api: ApiService,
    private readonly cdr: ChangeDetectorRef,
    private readonly router: Router,
    private readonly auth: AuthService,
  ) {}

  ngOnInit() {
    this.refresh();
  }

  toggleUploadPanel() {
    this.showUploadPanel = !this.showUploadPanel;
  }

  closeUploadPanel() {
    this.showUploadPanel = false;
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.showUploadPanel) {
      this.showUploadPanel = false;
    }
    this.closeMenu();
    this.closeComplianceMenu();
  }

  refresh() {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();

    this.api.listAllUploads().subscribe({
      next: (res) => {
        const docs = Array.isArray(res?.documents) ? res.documents : [];
        this.activeFramework = String(res?.activeFramework || '').trim();
        this.files = docs
          .map((doc) => this.mapDoc(doc, this.activeFramework))
          .sort((a, b) => b.uploadedAt - a.uploadedAt);
        this.ensureValidPage();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to load uploaded files right now.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  handleManagerUpload(files: File[]) {
    if (!this.canManageStatus || this.uploading) return;
    const cleanFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!cleanFiles.length) return;

    const userId = this.auth.user()?.id || '';
    const conversationId = userId ? `uploads-${userId}` : crypto.randomUUID();
    const language = this.getPreferredLanguage();

    this.uploading = true;
    this.uploadError = '';
    this.uploadNotice = 'Uploading...';
    this.cdr.markForCheck();

    this.api.uploadCustomerFiles(conversationId, cleanFiles, language).subscribe({
      next: (res) => {
        const docs = Array.isArray(res?.documents) ? res.documents : [];
        const count = docs.length || res?.count || cleanFiles.length;
        this.uploadNotice = `Uploaded ${count} file${count === 1 ? '' : 's'} successfully.`;
        this.uploading = false;
        this.showUploadPanel = false;
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

  deleteFile(file: UploadRow) {
    if (!confirm(`Delete ${file.name}?`)) return;
    this.api.deleteUpload(file.id).subscribe({
      next: () => {
        this.files = this.files.filter((item) => item.id !== file.id);
        this.ensureValidPage();
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to delete this file right now.';
        this.cdr.markForCheck();
      },
    });
  }

  toggleMenu(id: string, event?: MouseEvent) {
    event?.stopPropagation();
    this.openComplianceMenuId = null;
    this.openMenuId = this.openMenuId === id ? null : id;
  }

  closeMenu() {
    this.openMenuId = null;
  }

  toggleComplianceMenu(id: string, event?: MouseEvent) {
    event?.stopPropagation();
    this.openMenuId = null;
    this.openComplianceMenuId = this.openComplianceMenuId === id ? null : id;
  }

  closeComplianceMenu() {
    this.openComplianceMenuId = null;
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.closeMenu();
    this.closeComplianceMenu();
  }

  markReviewed(file: UploadRow) {
    this.api.updateUploadStatus(file.id, 'REVIEWED').subscribe({
      next: (res) => {
        if (res?.document) this.replaceFile(res.document);
        this.closeMenu();
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to update this file right now.';
        this.cdr.markForCheck();
      },
    });
  }

  markSubmitted(file: UploadRow) {
    if (file.statusCode === 'SUBMITTED') return;
    const match = String(file.matchStatus || '').toUpperCase();
    if (match && match !== 'COMPLIANT') {
      const proceed = confirm('This file is not marked COMPLIANT by the agent. Submit anyway?');
      if (!proceed) return;
    }
    this.api.updateUploadStatus(file.id, 'SUBMITTED').subscribe({
      next: (res) => {
        if (res?.document) this.replaceFile(res.document);
        this.closeMenu();
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to update this file right now.';
        this.cdr.markForCheck();
      },
    });
  }

  updateComplianceStatus(file: UploadRow, status: ComplianceStatus) {
    if (!this.canManageStatus) return;
    this.api.updateUploadMatchStatus(file.id, status).subscribe({
      next: (res) => {
        if (res?.document) this.replaceFile(res.document);
        this.closeComplianceMenu();
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to update compliance status right now.';
        this.cdr.markForCheck();
      },
    });
  }

  get canManageStatus() {
    const role = (this.auth.user()?.role || 'USER').toUpperCase();
    return role === 'ADMIN' || role === 'MANAGER';
  }

  get frameworkOptions() {
    const set = new Set(this.files.map((file) => file.framework).filter(Boolean));
    return ['All', ...Array.from(set).sort()];
  }

  get statusOptions() {
    const set = new Set(this.files.map((file) => file.status).filter(Boolean));
    return ['All', ...Array.from(set).sort()];
  }

  get visibleFiles() {
    const term = this.searchTerm.trim().toLowerCase();
    let list = [...this.files];

    if (term) {
      list = list.filter((file) => {
        const hay = [
          file.name,
          file.framework,
          file.status,
          file.chatTitle || '',
          file.frameworkReferences.join(' ')
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(term);
      });
    }

    if (this.frameworkFilter !== 'all') {
      list = list.filter((file) => file.framework === this.frameworkFilter);
    }

    if (this.statusFilter !== 'all') {
      list = list.filter((file) => file.status === this.statusFilter);
    }

    return this.sortFiles(list);
  }

  get totalVisibleFiles() {
    return this.visibleFiles.length;
  }

  get totalPages() {
    return Math.max(1, Math.ceil(this.totalVisibleFiles / this.pageSize));
  }

  get pagedVisibleFiles() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.visibleFiles.slice(start, start + this.pageSize);
  }

  get showingFrom() {
    if (!this.totalVisibleFiles) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get showingTo() {
    if (!this.totalVisibleFiles) return 0;
    return Math.min(this.currentPage * this.pageSize, this.totalVisibleFiles);
  }

  get pageNumbers() {
    const total = this.totalPages;
    const current = this.currentPage;
    if (total <= 7) return Array.from({ length: total }, (_, idx) => idx + 1);

    const start = Math.max(1, current - 2);
    const end = Math.min(total, start + 4);
    const normalizedStart = Math.max(1, end - 4);
    return Array.from({ length: end - normalizedStart + 1 }, (_, idx) => normalizedStart + idx);
  }

  onFiltersChanged() {
    this.currentPage = 1;
    this.closeMenu();
    this.closeComplianceMenu();
  }

  prevPage() {
    if (this.currentPage <= 1) return;
    this.currentPage -= 1;
  }

  nextPage() {
    if (this.currentPage >= this.totalPages) return;
    this.currentPage += 1;
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  updatePageSize(value: number | string) {
    const next = Number(value) || 10;
    if (this.pageSize === next) return;
    this.pageSize = next;
    this.currentPage = 1;
  }

  getRowNumber(index: number) {
    return (this.currentPage - 1) * this.pageSize + index + 1;
  }

  getComplianceLabel(status?: string | null) {
    const normalized = String(status || '').toUpperCase();
    if (normalized === 'COMPLIANT') return 'Compliant';
    if (normalized === 'PARTIAL') return 'Partial';
    if (normalized === 'NOT_COMPLIANT') return 'Not compliant';
    return 'Unknown';
  }

  getComplianceClass(status?: string | null) {
    const normalized = String(status || '').toUpperCase();
    if (normalized === 'COMPLIANT') return 'is-compliant';
    if (normalized === 'PARTIAL') return 'is-partial';
    if (normalized === 'NOT_COMPLIANT') return 'is-not-compliant';
    return 'is-unknown';
  }

  downloadFile(file: UploadRow) {
    this.api.downloadUpload(file.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.name || 'download';
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

  openUploadDetails(file: UploadRow, event?: Event) {
    event?.stopPropagation();
    this.router.navigate(['/uploads', file.id]);
  }

  trackByFileId(_index: number, file: UploadRow) {
    return file.id;
  }

  onRowKeydown(file: UploadRow, event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.openUploadDetails(file);
  }

  openFrameworkReference(reference: string, event?: Event) {
    event?.stopPropagation();
    const trimmed = String(reference || '').trim();
    if (!trimmed) return;
    this.router.navigate(['/control-kb'], {
      queryParams: {
        frameworkRef: trimmed,
      },
    });
  }

  private mapDoc(
    doc: UploadDocumentRecord,
    activeFramework: string,
  ): UploadRow {
    const size = this.formatSize(doc.sizeBytes ?? 0);
    const sizeBytes = Number(doc.sizeBytes ?? 0);
    const rawReferences = Array.isArray(doc.frameworkReferences)
      ? doc.frameworkReferences.filter((ref) => Boolean(ref))
      : [];
    const frameworkReferences = rawReferences;
    const framework = activeFramework || 'Unknown';
    const uploaderLabel = this.formatUploader(doc);
    const uploadedAt = doc?.createdAt ? new Date(doc.createdAt).getTime() : Date.now();
    const statusMeta = this.mapFileStatus(doc.submittedAt, doc.reviewedAt, doc.matchStatus);

    return {
      id: doc.id,
      name: doc.originalName || 'Document',
      framework,
      frameworkReferences,
      status: statusMeta.label,
      statusCode: statusMeta.code,
      size,
      sizeBytes,
      uploadedAt,
      chatTitle: doc?.conversation?.title,
      uploaderLabel,
      statusClass: statusMeta.className,
      matchStatus: doc?.matchStatus ?? null,
    };
  }

  private formatSize(bytes: number) {
    if (!bytes || bytes <= 0) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  private mapFileStatus(
    submittedAt?: string | null,
    reviewedAt?: string | null,
    matchStatus?: string | null,
  ) {
    if (submittedAt) {
      return { label: 'Submitted', className: 'submitted', code: 'SUBMITTED' as const };
    }
    if (reviewedAt) {
      return { label: 'Reviewed', className: 'reviewed', code: 'REVIEWED' as const };
    }
    const normalized = String(matchStatus || '').toUpperCase();
    if (normalized === 'COMPLIANT') {
      return { label: 'Ready to submit', className: 'ready', code: 'READY' as const };
    }
    return { label: 'Uploaded', className: 'uploaded', code: 'UPLOADED' as const };
  }

  private replaceFile(doc: UploadDocumentRecord) {
    const next = this.mapDoc(doc, this.activeFramework);
    this.files = this.files.map((file) => (file.id === next.id ? next : file));
    this.ensureValidPage();
  }

  private formatUploader(doc: UploadDocumentRecord) {
    const user = doc.conversation?.user;
    if (!user) return '';
    const name = String(user?.name || '').trim();
    const email = String(user?.email || '').trim();
    if (name && email) return `${name} · ${email}`;
    return name || email;
  }

  private sortFiles(list: UploadRow[]) {
    const sorted = [...list];
    const byText = (value: string) => (value || '').toLowerCase();

    switch (this.sortMode) {
      case 'oldest':
        return sorted.sort((a, b) => a.uploadedAt - b.uploadedAt);
      case 'name-asc':
        return sorted.sort((a, b) => byText(a.name).localeCompare(byText(b.name)));
      case 'name-desc':
        return sorted.sort((a, b) => byText(b.name).localeCompare(byText(a.name)));
      case 'size-asc':
        return sorted.sort((a, b) => a.sizeBytes - b.sizeBytes);
      case 'size-desc':
        return sorted.sort((a, b) => b.sizeBytes - a.sizeBytes);
      case 'recent':
      default:
        return sorted.sort((a, b) => b.uploadedAt - a.uploadedAt);
    }
  }

  private getPreferredLanguage(): 'ar' | 'en' {
    if (typeof navigator === 'undefined') return 'en';
    const lang = String(navigator.language || '').toLowerCase();
    return lang.startsWith('ar') ? 'ar' : 'en';
  }

  private ensureValidPage() {
    const total = this.totalPages;
    if (this.currentPage > total) this.currentPage = total;
    if (this.currentPage < 1) this.currentPage = 1;
  }
}
