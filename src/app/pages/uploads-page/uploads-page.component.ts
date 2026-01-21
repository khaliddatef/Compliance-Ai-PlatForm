import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, UploadDocumentRecord } from '../../services/api.service';

type UploadRow = {
  id: string;
  name: string;
  framework: string;
  frameworkReferences: string[];
  status: string;
  size: string;
  sizeBytes: number;
  uploadedAt: number;
  chatTitle?: string;
  uploaderLabel?: string;
  statusClass: string;
};

@Component({
  selector: 'app-uploads-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './uploads-page.component.html',
  styleUrl: './uploads-page.component.css'
})
export class UploadsPageComponent implements OnInit {
  files: UploadRow[] = [];
  loading = true;
  error = '';
  searchTerm = '';
  frameworkFilter = 'all';
  statusFilter = 'all';
  sortMode = 'recent';
  activeFramework = '';

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
    this.cdr.markForCheck();

    this.api.listAllUploads().subscribe({
      next: (res) => {
        const docs = Array.isArray(res?.documents) ? res.documents : [];
        this.activeFramework = String(res?.activeFramework || '').trim();
        this.files = docs
          .map((doc) => this.mapDoc(doc, this.activeFramework))
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

  private mapDoc(doc: UploadDocumentRecord, activeFramework: string): UploadRow {
    const size = this.formatSize(doc.sizeBytes ?? 0);
    const sizeBytes = Number(doc.sizeBytes ?? 0);
    const rawReferences = Array.isArray(doc.frameworkReferences)
      ? doc.frameworkReferences.filter((ref) => Boolean(ref))
      : [];
    const fallbackFramework = activeFramework ? [activeFramework] : [];
    const frameworkReferences = rawReferences.length ? rawReferences : fallbackFramework;
    const framework = frameworkReferences[0] || 'Unknown';
    const uploaderLabel = this.formatUploader(doc);
    const uploadedAt = doc?.createdAt ? new Date(doc.createdAt).getTime() : Date.now();
    const statusMeta = this.mapFileStatus(doc.submittedAt, doc.reviewedAt);

    return {
      id: doc.id,
      name: doc.originalName || 'Document',
      framework,
      frameworkReferences,
      status: statusMeta.label,
      size,
      sizeBytes,
      uploadedAt,
      chatTitle: doc?.conversation?.title,
      uploaderLabel,
      statusClass: statusMeta.className,
    };
  }

  private formatSize(bytes: number) {
    if (!bytes || bytes <= 0) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  private mapFileStatus(submittedAt?: string | null, reviewedAt?: string | null) {
    if (submittedAt) {
      return { label: 'Submitted', className: 'submitted' };
    }
    if (reviewedAt) {
      return { label: 'Reviewed', className: 'reviewed' };
    }
    return { label: 'Uploaded', className: 'uploaded' };
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
}
