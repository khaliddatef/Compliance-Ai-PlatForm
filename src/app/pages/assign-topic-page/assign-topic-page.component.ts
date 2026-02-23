import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  ApiService,
  ControlTopic,
  FrameworkSummary,
} from '../../services/api.service';

@Component({
  selector: 'app-assign-topic-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './assign-topic-page.component.html',
  styleUrl: './assign-topic-page.component.css',
})
export class AssignTopicPageComponent implements OnInit {
  frameworks: FrameworkSummary[] = [];
  topics: ControlTopic[] = [];

  loading = true;
  loadingTopics = false;
  saving = false;
  error = '';
  notice = '';

  targetFramework = '';
  sourceFramework = '';
  topicId = '';
  topicQuery = '';
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
      !!this.sourceFramework.trim() &&
      !!this.topicId
    );
  }

  get selectedTopicLabel() {
    return this.topics.find((topic) => topic.id === this.topicId)?.title || '';
  }

  get sourceFrameworkOptions() {
    const names = this.frameworks.map((framework) => framework.framework).filter(Boolean);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }

  get filteredTopics() {
    const query = this.topicQuery.trim().toLowerCase();
    if (!query) return this.topics;
    return this.topics.filter((topic) =>
      String(topic.title || '').toLowerCase().includes(query),
    );
  }

  async onTargetFrameworkChange() {
    this.notice = '';
    this.error = '';
    this.cdr.markForCheck();
  }

  async onSourceFrameworkChange() {
    this.notice = '';
    this.error = '';
    await this.loadTopics();
  }

  async onTopicChange() {
    this.notice = '';
    this.error = '';
    await this.refreshPreview();
  }

  async refreshTopics() {
    await this.loadTopics();
  }

  async assignTopic() {
    if (!this.canAssign) return;

    this.saving = true;
    this.error = '';
    this.notice = '';
    this.cdr.markForCheck();

    try {
      const response = await firstValueFrom(
        this.api.assignTopicToFramework(this.topicId, {
          framework: this.targetFramework.trim(),
          sourceFramework: this.sourceFramework.trim() || null,
        }),
      );

      const topicLabel = this.selectedTopicLabel || response?.topicTitle || 'Topic';
      const controlsAssigned = Number(response?.controlsAssigned || 0);
      const controlsUpdated = Number(response?.controlsUpdated || 0);
      const controlsRemoved = Number(response?.controlsRemoved || 0);
      this.notice = `${topicLabel} synced successfully. Added: ${controlsAssigned}, updated: ${controlsUpdated}, removed: ${controlsRemoved}.`;
    } catch (error) {
      this.error = this.parseApiError(error, 'Unable to assign topic.');
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  backToTopics() {
    const queryParams: Record<string, string> = {};
    if (this.targetFramework) queryParams['framework'] = this.targetFramework;
    this.router.navigate(['/framework-controls'], { queryParams });
  }

  private async bootstrap() {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();

    try {
      await this.loadFrameworks();
      this.applyQueryDefaults();
      await this.loadTopics();
    } catch (error) {
      this.error = this.parseApiError(error, 'Unable to load assign topic page.');
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

    if (!this.sourceFramework) {
      this.sourceFramework = this.targetFramework || this.frameworks[0]?.framework || '';
    }
  }

  private async loadTopics() {
    this.loadingTopics = true;
    this.cdr.markForCheck();

    try {
      const topics = await firstValueFrom(this.api.listControlTopics(this.sourceFramework || undefined));
      this.topics = Array.isArray(topics) ? topics : [];
      const existing = this.topics.some((topic) => topic.id === this.topicId);
      if (!existing) {
        this.topicId = this.topics[0]?.id || '';
      }
      await this.refreshPreview();
    } finally {
      this.loadingTopics = false;
      this.cdr.markForCheck();
    }
  }

  private async refreshPreview() {
    if (!this.topicId) {
      this.loadedControls = 0;
      this.cdr.markForCheck();
      return;
    }

    try {
      const response = await firstValueFrom(
        this.api.listControlDefinitions({
          topicId: this.topicId,
          framework: this.sourceFramework || undefined,
          page: 1,
          pageSize: 1,
        }),
      );
      this.loadedControls = Number(response?.total || 0);
    } catch {
      this.loadedControls = 0;
    } finally {
      this.cdr.markForCheck();
    }
  }

  private applyQueryDefaults() {
    const params = this.route.snapshot.queryParamMap;
    const framework = String(params.get('framework') || '').trim();
    const sourceFramework = String(params.get('sourceFramework') || '').trim();
    const topicId = String(params.get('topicId') || '').trim();

    if (framework && this.frameworks.some((item) => item.framework === framework)) {
      this.targetFramework = framework;
    }

    if (
      sourceFramework &&
      this.frameworks.some((item) => item.framework === sourceFramework)
    ) {
      this.sourceFramework = sourceFramework;
    } else if (!this.sourceFramework) {
      this.sourceFramework = this.targetFramework;
    }

    if (topicId) {
      this.topicId = topicId;
    }
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
