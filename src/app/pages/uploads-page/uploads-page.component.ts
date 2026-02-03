import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
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

@Component({
  selector: 'app-uploads-page',
  standalone: true,
  imports: [CommonModule, FormsModule, UploadDropzoneComponent],
  templateUrl: './uploads-page.component.html',
  styleUrl: './uploads-page.component.css'
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
  activeFramework = '';
  activeFrameworkVersion = '';
  openMenuId: string | null = null;

  constructor(
    private readonly api: ApiService,
    private readonly cdr: ChangeDetectorRef,
    private readonly router: Router,
    private readonly auth: AuthService,
  ) {}

  ngOnInit() {
    this.refresh();
  }

  refresh() {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();

    this.api.listAllUploads().subscribe({
      next: (res) => {
        const docs = Array.isArray(res?.documents) ? res.documents : [];
        this.activeFramework = String(res?.activeFramework || '').trim();
        this.activeFrameworkVersion = String(res?.activeFrameworkVersion || '').trim();
        this.files = docs
          .map((doc) => this.mapDoc(doc, this.activeFramework, this.activeFrameworkVersion))
          .sort((a, b) => b.uploadedAt - a.uploadedAt);
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
    this.openMenuId = this.openMenuId === id ? null : id;
  }

  closeMenu() {
    this.openMenuId = null;
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.closeMenu();
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

  openFrameworkReference(reference: string) {
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
    activeFrameworkVersion: string,
  ): UploadRow {
    const size = this.formatSize(doc.sizeBytes ?? 0);
    const sizeBytes = Number(doc.sizeBytes ?? 0);
    const rawReferences = Array.isArray(doc.frameworkReferences)
      ? doc.frameworkReferences.filter((ref) => Boolean(ref))
      : [];
    const versionLabel = this.formatVersionLabel(activeFrameworkVersion, activeFramework);
    const fallbackReferences = versionLabel ? [versionLabel] : [];
    const frameworkReferences = rawReferences.length ? rawReferences : fallbackReferences;
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

  private formatVersionLabel(version: string, frameworkName: string) {
    const raw = String(version || '').trim();
    if (raw) return raw.toLowerCase().startsWith('v') ? raw : `v${raw}`;
    const match = String(frameworkName || '').match(/\b(v?\d{4})\b/i);
    if (!match) return '';
    return match[1].toLowerCase().startsWith('v') ? match[1] : `v${match[1]}`;
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
    const next = this.mapDoc(doc, this.activeFramework, this.activeFrameworkVersion);
    this.files = this.files.map((file) => (file.id === next.id ? next : file));
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
}
