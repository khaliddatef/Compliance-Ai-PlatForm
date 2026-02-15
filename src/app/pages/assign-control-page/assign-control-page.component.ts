import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  ApiService,
  ControlDefinitionRecord,
  ControlTopic,
  FrameworkSummary,
} from '../../services/api.service';

@Component({
  selector: 'app-assign-control-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './assign-control-page.component.html',
  styleUrl: './assign-control-page.component.css',
})
export class AssignControlPageComponent implements OnInit {
  frameworks: FrameworkSummary[] = [];
  topics: ControlTopic[] = [];
  controls: ControlDefinitionRecord[] = [];

  loading = true;
  loadingControls = false;
  saving = false;
  error = '';
  notice = '';

  targetFramework = '';
  topicId = '';
  sourceFramework = 'all';
  controlQuery = '';
  selectedControlId = '';
  referenceCode = '';
  loadedControls = 0;

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    void this.bootstrap();
  }

  get canAssign() {
    return (
      !this.saving &&
      !!this.targetFramework.trim() &&
      !!this.selectedControlId &&
      !!this.referenceCode.trim()
    );
  }

  get selectedControl() {
    return this.controls.find((control) => control.id === this.selectedControlId) || null;
  }

  get selectedTopicLabel() {
    if (!this.topicId) return '';
    return this.topics.find((topic) => topic.id === this.topicId)?.title || '';
  }

  get sourceFrameworkOptions() {
    const names = this.frameworks.map((framework) => framework.framework).filter(Boolean);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }

  async onTargetFrameworkChange() {
    this.notice = '';
    this.error = '';
    await this.loadTopics();
    this.referenceCode = '';
    this.prefillReferenceCode();
  }

  onControlChanged() {
    this.notice = '';
    this.referenceCode = '';
    this.prefillReferenceCode();
  }

  async refreshControls() {
    this.loadingControls = true;
    this.error = '';
    this.notice = '';
    this.cdr.markForCheck();

    try {
      const controls = await this.fetchAllControls({
        framework: this.sourceFramework !== 'all' ? this.sourceFramework : undefined,
        query: this.controlQuery.trim() || undefined,
      });
      this.controls = controls;
      this.loadedControls = controls.length;

      const selectedStillExists = this.controls.some(
        (control) => control.id === this.selectedControlId,
      );
      if (!selectedStillExists) {
        this.selectedControlId = this.controls[0]?.id || '';
        this.referenceCode = '';
      }
      this.prefillReferenceCode();
    } catch (error) {
      this.error = this.parseApiError(error, 'Unable to load controls.');
    } finally {
      this.loadingControls = false;
      this.cdr.markForCheck();
    }
  }

  async assignControl() {
    if (!this.canAssign) return;
    const control = this.selectedControl;
    if (!control) {
      this.error = 'Select a control first.';
      return;
    }

    this.saving = true;
    this.error = '';
    this.notice = '';
    this.cdr.markForCheck();

    try {
      const response = await firstValueFrom(
        this.api.assignControlToFramework(control.id, {
          framework: this.targetFramework.trim(),
          frameworkCode: this.referenceCode.trim(),
          topicId: this.topicId || null,
        }),
      );

      const updatedControl = response?.control;
      if (updatedControl) {
        this.controls = this.controls.map((item) =>
          item.id === updatedControl.id ? updatedControl : item,
        );
      }

      const topicLabel = this.selectedTopicLabel;
      this.notice = topicLabel
        ? `Control assigned successfully to topic: ${topicLabel}.`
        : 'Control assigned successfully.';
    } catch (error) {
      this.error = this.parseApiError(error, 'Unable to assign control.');
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  backToControlKb() {
    const queryParams: Record<string, string> = {};
    if (this.targetFramework) queryParams['framework'] = this.targetFramework;
    if (this.topicId) queryParams['topicId'] = this.topicId;
    this.router.navigate(['/control-kb'], { queryParams });
  }

  getControlLabel(control: ControlDefinitionRecord) {
    const code = String(control.controlCode || '').trim();
    const title = String(control.title || '').trim();
    if (code && title) return `${code} - ${title}`;
    return code || title || control.id;
  }

  private async bootstrap() {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();

    try {
      await this.loadFrameworks();
      this.applyQueryDefaults();
      await this.loadTopics();
      await this.refreshControls();
    } catch (error) {
      this.error = this.parseApiError(error, 'Unable to load assign control page.');
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  private async loadFrameworks() {
    const frameworks = await firstValueFrom(this.api.listFrameworks());
    const list = Array.isArray(frameworks) ? frameworks : [];
    this.frameworks = this.sortFrameworks(list);

    if (!this.targetFramework) {
      const enabled = this.frameworks.find((framework) => framework.status === 'enabled');
      this.targetFramework = enabled?.framework || this.frameworks[0]?.framework || '';
    }
  }

  private async loadTopics() {
    const topics = await firstValueFrom(this.api.listControlTopics(this.targetFramework || undefined));
    this.topics = Array.isArray(topics) ? topics : [];

    if (this.topicId && !this.topics.some((topic) => topic.id === this.topicId)) {
      this.topicId = '';
    }
  }

  private applyQueryDefaults() {
    const params = this.route.snapshot.queryParamMap;

    const framework = String(params.get('framework') || '').trim();
    if (framework && this.frameworks.some((item) => item.framework === framework)) {
      this.targetFramework = framework;
    }

    const topicId = String(params.get('topicId') || '').trim();
    if (topicId) {
      this.topicId = topicId;
    }

    const sourceFramework = String(params.get('sourceFramework') || '').trim();
    if (
      sourceFramework &&
      (sourceFramework === 'all' ||
        this.frameworks.some((frameworkItem) => frameworkItem.framework === sourceFramework))
    ) {
      this.sourceFramework = sourceFramework;
    }

    const query = String(params.get('q') || '').trim();
    if (query) {
      this.controlQuery = query;
    }

    const controlId = String(params.get('controlId') || '').trim();
    if (controlId) {
      this.selectedControlId = controlId;
    }
  }

  private async fetchAllControls(filters: { framework?: string; query?: string }) {
    const pageSize = 500;
    const all: ControlDefinitionRecord[] = [];
    let page = 1;
    let total = 0;

    do {
      const response = await firstValueFrom(
        this.api.listControlDefinitions({
          framework: filters.framework,
          query: filters.query,
          status: 'enabled',
          page,
          pageSize,
        }),
      );
      const rows = Array.isArray(response?.items) ? response.items : [];
      total = Number(response?.total || rows.length);
      all.push(...rows);
      if (!rows.length) break;
      page += 1;
    } while (all.length < total);

    return all;
  }

  private prefillReferenceCode() {
    if (this.referenceCode.trim()) return;
    const control = this.selectedControl;
    if (!control) return;

    const suggestion = this.suggestReferenceCode(control);
    if (suggestion) {
      this.referenceCode = suggestion;
    }
  }

  private suggestReferenceCode(control: ControlDefinitionRecord) {
    const targetFramework = this.targetFramework.trim().toLowerCase();
    const frameworkMatch = (control.frameworkMappings || []).find((mapping) => {
      const framework = String(mapping.framework || '').trim().toLowerCase();
      return framework && framework === targetFramework && String(mapping.frameworkCode || '').trim();
    });

    if (frameworkMatch?.frameworkCode) {
      return String(frameworkMatch.frameworkCode).trim();
    }

    const iso = Array.isArray(control.isoMappings)
      ? control.isoMappings.map((value) => String(value || '').trim()).find(Boolean)
      : '';
    if (iso) return iso;

    const code = String(control.controlCode || '').trim();
    return code;
  }

  private parseApiError(error: any, fallback: string) {
    const message = error?.error?.message || error?.message;
    return String(message || fallback).trim() || fallback;
  }

  private sortFrameworks(frameworks: FrameworkSummary[]) {
    return [...frameworks].sort((a, b) => {
      const aEnabled = a.status === 'enabled';
      const bEnabled = b.status === 'enabled';
      if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
      return String(a.framework || '').localeCompare(String(b.framework || ''));
    });
  }
}
