import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ApiService, ComplianceStandard, FrameworkSummary } from '../../services/api.service';

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
  standard: ComplianceStandard = 'ISO';
  showNewFramework = false;
  newFrameworkName = '';
  creating = false;

  constructor(
    private readonly auth: AuthService,
    private readonly api: ApiService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.api.listFrameworks(this.standard).subscribe({
      next: (frameworks) => {
        this.frameworks = this.sortFrameworks(frameworks || []);
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
    this.api.createFramework({ standard: this.standard, name }).subscribe({
      next: (created) => {
        this.frameworks = this.sortFrameworks([
          created,
          ...this.frameworks.filter((item) => item.id !== created.id),
        ]);
        this.newFrameworkName = '';
        this.showNewFramework = false;
        this.error = '';
        this.creating = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to create framework.';
        this.creating = false;
        this.cdr.markForCheck();
      },
    });
  }

  toggleFramework(framework: FrameworkSummary) {
    if (!this.isAdmin) return;
    this.error = '';
    const nextStatus = framework.status === 'enabled' ? 'disabled' : 'enabled';
    const previous = { ...framework };
    this.frameworks = this.sortFrameworks(
      this.frameworks.map((item) =>
        item.id === framework.id ? { ...item, status: nextStatus } : item,
      ),
    );
    this.api.updateFramework(framework.id, { status: nextStatus }).subscribe({
      next: (updated) => {
        this.frameworks = this.sortFrameworks(
          this.frameworks.map((item) => (item.id === updated.id ? updated : item)),
        );
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to update framework status.';
        this.frameworks = this.sortFrameworks(
          this.frameworks.map((item) => (item.id === previous.id ? previous : item)),
        );
        this.cdr.markForCheck();
      },
    });
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
}
