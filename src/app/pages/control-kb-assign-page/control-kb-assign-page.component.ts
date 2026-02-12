import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService, ControlDefinitionRecord, ControlTopic } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-control-kb-assign-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './control-kb-assign-page.component.html',
  styleUrl: './control-kb-assign-page.component.css',
})
export class ControlKbAssignPageComponent implements OnInit {
  loading = true;
  error = '';
  success = '';

  topics: ControlTopic[] = [];
  frameworkOptions: string[] = [];
  frameworkStatusMap = new Map<string, string>();

  targetFramework = '';
  topicFilter = 'all';
  assignSourceFramework = 'all';
  assignSearchTerm = '';
  assignResults: ControlDefinitionRecord[] = [];
  assignSelectedControlId = '';
  assignReferenceCode = '';
  assignLoading = false;
  assignError = '';

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  get canEdit() {
    return this.auth.user()?.role === 'ADMIN';
  }

  get selectedTopicLabel() {
    if (this.topicFilter === 'all') return '';
    return this.topics.find((topic) => topic.id === this.topicFilter)?.title || '';
  }

  ngOnInit() {
    this.route.queryParamMap.subscribe((params) => {
      const preferredFramework = String(params.get('framework') || '').trim();
      const preferredTopicId = String(params.get('topicId') || '').trim();
      this.loadContext(preferredFramework, preferredTopicId);
    });
  }

  goBack() {
    const queryParams: Record<string, string> = {};
    if (this.targetFramework) queryParams['framework'] = this.targetFramework;
    if (this.topicFilter !== 'all') queryParams['topicId'] = this.topicFilter;
    this.router.navigate(['/control-kb'], { queryParams });
  }

  onTargetFrameworkChange() {
    this.success = '';
  }

  onAssignSourceFrameworkChange() {
    this.assignSelectedControlId = '';
    this.assignReferenceCode = '';
    this.searchAssignableControls();
  }

  searchAssignableControls() {
    const query = this.assignSearchTerm.trim();
    const framework = this.assignSourceFramework.trim();
    const baseParams: {
      query?: string;
      framework?: string;
      page?: number;
      pageSize?: number;
    } = {
      query: query || undefined,
      framework: framework && framework !== 'all' ? framework : undefined,
      pageSize: 500,
    };

    this.assignLoading = true;
    this.assignError = '';
    this.success = '';

    this.api
      .listControlDefinitions({
        page: 1,
        ...baseParams,
      })
      .subscribe({
        next: (firstPage) => {
          const firstItems = Array.isArray(firstPage?.items) ? firstPage.items : [];
          const total = Math.max(Number(firstPage?.total) || 0, firstItems.length);
          const totalPages = Math.max(1, Math.ceil(total / 500));

          if (totalPages <= 1) {
            this.applyAssignableResults(firstItems);
            return;
          }

          const pageRequests = [];
          for (let page = 2; page <= totalPages; page += 1) {
            pageRequests.push(
              this.api.listControlDefinitions({
                ...baseParams,
                page,
              }),
            );
          }

          forkJoin(pageRequests).subscribe({
            next: (pages) => {
              const allItems = [...firstItems];
              for (const page of pages) {
                const items = Array.isArray(page?.items) ? page.items : [];
                allItems.push(...items);
              }
              this.applyAssignableResults(allItems);
            },
            error: () => {
              this.failAssignableControls('Unable to load controls.');
            },
          });
        },
        error: () => {
          this.failAssignableControls('Unable to load controls.');
        },
      });
  }

  onAssignControlSelectionChange() {
    const selected = this.assignResults.find((item) => item.id === this.assignSelectedControlId);
    this.assignReferenceCode = this.getDefaultFrameworkCode(selected);
  }

  assignControl() {
    if (!this.canEdit) return;

    const targetFramework = this.targetFramework.trim();
    if (!targetFramework) {
      this.assignError = 'Select a target framework.';
      return;
    }

    const controlId = this.assignSelectedControlId.trim();
    if (!controlId) {
      this.assignError = 'Select a control to assign.';
      return;
    }

    const selected = this.assignResults.find((item) => item.id === controlId);
    const sourceTopicId = String(selected?.topicId || '').trim();
    const frameworkCode =
      this.assignReferenceCode.trim() || this.getDefaultFrameworkCode(selected) || selected?.controlCode || '';
    if (!frameworkCode) {
      this.assignError = 'Reference code is required.';
      return;
    }

    this.assignLoading = true;
    this.assignError = '';
    this.success = '';

    this.api
      .addControlFrameworkMapping(controlId, {
        framework: targetFramework,
        frameworkCode,
        relationshipType: 'RELATED',
      })
      .subscribe({
        next: (updated) => {
          if (this.topicFilter !== 'all') {
            const targetTopicId = this.topicFilter;
            this.api.addControlTopicMapping(controlId, targetTopicId, 'PRIMARY').subscribe({
              next: () => {
                if (sourceTopicId && sourceTopicId !== targetTopicId) {
                  this.api.removeControlTopicMapping(controlId, sourceTopicId).subscribe({
                    next: () => this.finishAssignControl(),
                    error: () => {
                      this.assignLoading = false;
                      this.assignError = 'Framework assigned, but failed to move control to selected topic.';
                      this.cdr.markForCheck();
                    },
                  });
                  return;
                }
                this.finishAssignControl();
              },
              error: () => {
                this.assignLoading = false;
                this.assignError = 'Framework assigned, but failed to map topic.';
                this.cdr.markForCheck();
              },
            });
            return;
          }
          this.finishAssignControl();
        },
        error: () => {
          this.assignLoading = false;
          this.assignError = 'Unable to assign control.';
          this.cdr.markForCheck();
        },
      });
  }

  private loadContext(preferredFramework: string, preferredTopicId: string) {
    this.loading = true;
    this.error = '';
    this.success = '';
    this.assignError = '';
    this.assignResults = [];
    this.assignSelectedControlId = '';
    this.assignReferenceCode = '';
    this.assignSearchTerm = '';
    this.assignSourceFramework = 'all';

    forkJoin({
      frameworks: this.api.listFrameworks(),
      topics: this.api.listControlTopics(),
    }).subscribe({
      next: ({ frameworks, topics }) => {
        const frameworkList = frameworks || [];
        this.frameworkStatusMap = new Map(frameworkList.map((fw) => [fw.framework, fw.status]));
        this.frameworkOptions = Array.from(
          new Set(frameworkList.map((fw) => String(fw.framework || '').trim()).filter(Boolean)),
        ).sort((a, b) => a.localeCompare(b));

        this.topics = topics || [];
        const foundTopic = this.topics.find((topic) => topic.id === preferredTopicId);
        this.topicFilter = foundTopic ? foundTopic.id : 'all';

        const activeFramework = frameworkList.find((fw) => fw.status === 'enabled')?.framework || '';
        const requestedFramework = preferredFramework && preferredFramework !== 'all' ? preferredFramework : '';
        const isRequestedValid = requestedFramework && this.frameworkOptions.includes(requestedFramework);
        this.targetFramework = isRequestedValid ? requestedFramework : activeFramework || '';

        this.loading = false;
        if (!this.targetFramework) {
          this.assignError = 'No active framework found. Select a target framework first.';
          this.cdr.markForCheck();
          return;
        }

        this.searchAssignableControls();
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.error = 'Unable to load assignment data.';
        this.cdr.markForCheck();
      },
    });
  }

  private finishAssignControl() {
    this.assignLoading = false;
    this.success = 'Control assigned successfully.';
    this.cdr.markForCheck();
  }

  private getDefaultFrameworkCode(control?: ControlDefinitionRecord) {
    const fromIso = Array.isArray(control?.isoMappings) ? String(control?.isoMappings[0] || '').trim() : '';
    if (fromIso) return fromIso;
    return String(control?.controlCode || '').trim();
  }

  private applyAssignableResults(items: ControlDefinitionRecord[]) {
    const unique = Array.from(new Map(items.map((item) => [item.id, item])).values());
    this.assignResults = unique;
    if (!this.assignResults.length) {
      this.assignSelectedControlId = '';
      this.assignReferenceCode = '';
      this.assignError = 'No controls found for the selected filters.';
    } else if (!this.assignResults.some((item) => item.id === this.assignSelectedControlId)) {
      this.assignSelectedControlId = this.assignResults[0].id;
      this.onAssignControlSelectionChange();
    }
    this.assignLoading = false;
    this.cdr.markForCheck();
  }

  private failAssignableControls(message: string) {
    this.assignResults = [];
    this.assignSelectedControlId = '';
    this.assignReferenceCode = '';
    this.assignError = message;
    this.assignLoading = false;
    this.cdr.markForCheck();
  }
}
