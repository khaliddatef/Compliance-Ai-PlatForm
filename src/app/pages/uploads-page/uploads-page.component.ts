import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, UploadDocumentRecord } from '../../services/api.service';

type UploadRow = {
  id: string;
  name: string;
  framework: string;
  status: string;
  size: string;
  sizeBytes: number;
  uploadedAt: number;
  chatTitle?: string;
  controlId: string;
  matchStatus: string;
  matchLabel: string;
  matchClass: string;
  matchNote: string;
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

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.refresh();
  }

  refresh() {
    this.loading = true;
    this.error = '';

    this.api.listAllUploads().subscribe({
      next: (res) => {
        const docs = Array.isArray(res?.documents) ? res.documents : [];
        this.files = docs
          .map((doc) => this.mapDoc(doc))
          .sort((a, b) => b.uploadedAt - a.uploadedAt);
        this.loading = false;
      },
      error: () => {
        this.error = 'Unable to load uploaded files right now.';
        this.loading = false;
      },
    });
  }

  deleteFile(file: UploadRow) {
    if (!confirm(`Delete ${file.name}?`)) return;
    this.api.deleteUpload(file.id).subscribe({
      next: () => {
        this.files = this.files.filter((item) => item.id !== file.id);
      },
      error: () => {
        this.error = 'Unable to delete this file right now.';
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
          file.controlId,
          file.matchLabel,
          file.matchNote
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
      },
    });
  }

  private mapDoc(doc: UploadDocumentRecord): UploadRow {
    const size = this.formatSize(doc.sizeBytes ?? 0);
    const sizeBytes = Number(doc.sizeBytes ?? 0);
    const framework = this.standardLabel(doc.standard);
    const uploadedAt = doc?.createdAt ? new Date(doc.createdAt).getTime() : Date.now();
    const matchStatus = String(doc.matchStatus || 'PENDING').toUpperCase();
    const matchMeta = this.mapMatchStatus(matchStatus);
    const matchNote = doc.matchNote || matchMeta.note;
    const controlId = doc.matchControlId ? String(doc.matchControlId) : '—';
    const statusMeta = this.mapFileStatus(doc.submittedAt, doc.reviewedAt);

    return {
      id: doc.id,
      name: doc.originalName || 'Document',
      framework,
      status: statusMeta.label,
      size,
      sizeBytes,
      uploadedAt,
      chatTitle: doc?.conversation?.title,
      controlId,
      matchStatus,
      matchLabel: matchMeta.label,
      matchClass: matchMeta.className,
      matchNote,
      statusClass: statusMeta.className,
    };
  }

  private standardLabel(standard: string) {
    if (standard === 'ISO') return 'ISO 27001';
    if (standard === 'FRA') return 'FRA';
    if (standard === 'CBE') return 'CBE';
    return standard || 'Unknown';
  }

  private formatSize(bytes: number) {
    if (!bytes || bytes <= 0) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  private mapMatchStatus(status: string) {
    switch (status) {
      case 'COMPLIANT':
        return { label: 'Matched', className: 'match-ok', note: 'Evidence appears to match this control.' };
      case 'PARTIAL':
        return { label: 'Partial', className: 'match-partial', note: 'Evidence partially matches this control.' };
      case 'NOT_COMPLIANT':
        return { label: 'Missing', className: 'match-bad', note: 'Evidence does not satisfy this control.' };
      case 'UNKNOWN':
        return { label: 'Unknown', className: 'match-unknown', note: 'Insufficient evidence to assess.' };
      case 'UNMATCHED':
        return { label: 'Not matched', className: 'match-pending', note: 'Not referenced in evidence review.' };
      case 'PENDING':
      default:
        return { label: 'Pending', className: 'match-pending', note: 'No evidence review yet.' };
    }
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
