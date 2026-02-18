import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ApiService, FrameworkSummary } from '../../services/api.service';

@Component({
  selector: 'app-frameworks-page',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './frameworks-page.component.html',
  styleUrl: './frameworks-page.component.css'
})
export class FrameworksPageComponent implements OnInit {
  frameworks: FrameworkSummary[] = [];
  loading = true;
  error = '';
  showNewFramework = false;
  newFrameworkName = '';
  creating = false;
  openMenuId: string | null = null;
  currentPage = 1;
  pageSize = 10;
  readonly pageSizeOptions = [5, 10, 20, 50];

  constructor(
    private readonly auth: AuthService,
    private readonly api: ApiService,
    private readonly cdr: ChangeDetectorRef,
    private readonly router: Router
  ) {}

  ngOnInit() {
    this.loadFrameworks();
  }

  get isAdmin() {
    return this.auth.user()?.role === 'ADMIN';
  }

  get isManager() {
    return this.auth.user()?.role === 'MANAGER';
  }

  toggleNewFramework() {
    this.error = '';
    this.showNewFramework = !this.showNewFramework;
    if (!this.showNewFramework) {
      this.newFrameworkName = '';
    }
  }

  createFramework() {
    if (!this.isAdmin) return;
    const name = this.newFrameworkName.trim();
    if (!name || this.creating) return;
    this.error = '';
    this.creating = true;
    this.api.createFramework({ name }).subscribe({
      next: () => {
        this.newFrameworkName = '';
        this.showNewFramework = false;
        this.error = '';
        this.creating = false;
        this.loadFrameworks();
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to create framework.';
        this.creating = false;
        this.cdr.markForCheck();
      },
    });
  }

  toggleFramework(framework: FrameworkSummary, event?: MouseEvent) {
    event?.stopPropagation();
    if (!this.isAdmin) return;
    this.error = '';
    const nextStatus = framework.status === 'enabled' ? 'disabled' : 'enabled';
    this.api.updateFramework(framework.id, { status: nextStatus }).subscribe({
      next: () => this.loadFrameworks(),
      error: () => {
        this.error = 'Unable to update framework status.';
        this.cdr.markForCheck();
      },
    });
  }

  toggleActionsMenu(frameworkId: string, event?: MouseEvent) {
    event?.stopPropagation();
    this.openMenuId = this.openMenuId === frameworkId ? null : frameworkId;
  }

  closeActionsMenu() {
    this.openMenuId = null;
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.closeActionsMenu();
  }

  editFramework(framework: FrameworkSummary, event?: MouseEvent) {
    event?.stopPropagation();
    if (!this.isAdmin) return;

    const current = String(framework.framework || '').trim();
    const next = String(window.prompt('Edit framework name', current) || '').trim();
    if (!next || next === current) {
      this.closeActionsMenu();
      return;
    }

    this.error = '';
    this.api.updateFramework(framework.id, { name: next }).subscribe({
      next: () => {
        this.closeActionsMenu();
        this.loadFrameworks();
      },
      error: (err) => {
        const message = String(err?.error?.message || '').trim();
        this.error = message || 'Unable to update framework name.';
        this.closeActionsMenu();
        this.cdr.markForCheck();
      },
    });
  }

  deleteFramework(framework: FrameworkSummary, event?: MouseEvent) {
    event?.stopPropagation();
    if (!this.isAdmin) return;

    const label = framework.frameworkId || framework.framework;
    if (!confirm(`Delete framework "${label}"? This removes its mappings.`)) return;

    this.error = '';
    this.api.deleteFramework(framework.id).subscribe({
      next: () => {
        this.closeActionsMenu();
        this.loadFrameworks();
      },
      error: (err) => {
        const message = String(err?.error?.message || '').trim();
        this.error = message || 'Unable to delete framework.';
        this.closeActionsMenu();
        this.cdr.markForCheck();
      },
    });
  }

  get totalItems() {
    return this.frameworks.length;
  }

  get totalPages() {
    return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
  }

  get pagedFrameworks() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.frameworks.slice(start, start + this.pageSize);
  }

  get showingFrom() {
    if (!this.totalItems) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get showingTo() {
    if (!this.totalItems) return 0;
    return Math.min(this.currentPage * this.pageSize, this.totalItems);
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

  updatePageSize(value: string | number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    this.pageSize = parsed;
    this.currentPage = 1;
  }

  openFramework(framework: FrameworkSummary) {
    const target = String(framework.framework || '').trim();
    if (!target) return;
    this.closeActionsMenu();
    this.router.navigate(['/framework-controls'], { queryParams: { framework: target } });
  }

  getFrameworkIndex(index: number) {
    return (this.currentPage - 1) * this.pageSize + index + 1;
  }

  private ensureValidPage() {
    const total = this.totalPages;
    if (this.currentPage > total) {
      this.currentPage = total;
    }
    if (this.currentPage < 1) {
      this.currentPage = 1;
    }
  }

  private sortFrameworks(frameworks: FrameworkSummary[]) {
    return [...frameworks].sort((a, b) => {
      const aActive = a.status === 'enabled';
      const bActive = b.status === 'enabled';
      if (aActive !== bActive) return aActive ? -1 : 1;
      const aLabel = a.frameworkId || a.framework;
      const bLabel = b.frameworkId || b.framework;
      return aLabel.localeCompare(bLabel);
    });
  }

  private loadFrameworks() {
    this.loading = true;
    this.api.listFrameworks().subscribe({
      next: (frameworks) => {
        this.frameworks = this.sortFrameworks(frameworks || []);
        this.ensureValidPage();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to load frameworks.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }
}
