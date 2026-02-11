import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, ControlDefinitionRecord, ControlTopic } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { finalize } from 'rxjs/operators';

type TopicForm = {
  title: string;
  description: string;
  mode: string;
  status: string;
  priority: number;
};

type ControlForm = {
  topicId: string;
  controlCode: string;
  title: string;
  isoMappingsText: string;
  status: string;
};

type TopicView = ControlTopic & {
  expanded: boolean;
  loading: boolean;
  controls: ControlDefinitionRecord[];
  page: number;
  total: number;
  showNewControl: boolean;
  draftControl: ControlForm;
};

@Component({
  selector: 'app-framework-controls-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './framework-controls-page.component.html',
  styleUrl: './framework-controls-page.component.css',
})
export class FrameworkControlsPageComponent implements OnInit {
  framework = '';
  topics: TopicView[] = [];
  loading = true;
  error = '';
  pageSize = 10;
  showNewTopic = false;
  creatingTopic = false;

  topicDraft: TopicForm = {
    title: '',
    description: '',
    mode: 'continuous',
    status: 'enabled',
    priority: 0,
  };

  editingTopicId: string | null = null;
  topicEdit: TopicForm | null = null;

  editingControlId: string | null = null;
  controlEdit: ControlForm | null = null;
  openTopicMenuId: string | null = null;
  deletingTopicIds = new Set<string>();

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.route.queryParamMap.subscribe((params) => {
      this.framework = String(params.get('framework') || '').trim();
      this.fetchTopics();
    });
  }

  get isAdmin() {
    return this.auth.user()?.role === 'ADMIN';
  }

  get frameworkLabel() {
    return this.framework || 'Active framework';
  }

  fetchTopics() {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();
    this.api.listControlTopics(this.framework || undefined).subscribe({
      next: (topics) => {
        this.topics = (topics || []).map((topic) => this.toTopicView(topic));
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to load topics.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  openTopicControls(topic: TopicView) {
    const params: Record<string, string> = {
      topicId: topic.id,
    };
    if (this.framework) {
      params['framework'] = this.framework;
    }
    this.router.navigate(['/control-kb'], { queryParams: params });
  }

  loadTopicControls(topic: TopicView, reset: boolean) {
    if (topic.loading) return;
    topic.loading = true;
    if (reset) {
      topic.page = 1;
      topic.controls = [];
    }
    this.cdr.markForCheck();

    this.api
      .listControlDefinitions({
        topicId: topic.id,
        framework: this.framework || undefined,
        page: topic.page,
        pageSize: this.pageSize,
      })
      .subscribe({
        next: (res) => {
          const items = res?.items || [];
          topic.total = res?.total || 0;
          topic.controls = reset ? items : [...topic.controls, ...items];
          topic.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          topic.loading = false;
          this.error = 'Unable to load controls.';
          this.cdr.markForCheck();
        },
      });
  }

  loadMore(topic: TopicView) {
    if (topic.controls.length >= topic.total) return;
    topic.page += 1;
    this.loadTopicControls(topic, false);
  }

  createTopic() {
    if (!this.isAdmin || this.creatingTopic) return;
    const title = this.topicDraft.title.trim();
    if (!title) return;

    const draft: TopicForm = {
      title,
      description: this.topicDraft.description.trim(),
      mode: this.topicDraft.mode,
      status: this.topicDraft.status,
      priority: this.topicDraft.priority,
    };
    const tempId = `tmp-topic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticTopic = this.toTopicView({
      id: tempId,
      title: draft.title,
      description: draft.description,
      mode: draft.mode,
      status: draft.status,
      priority: draft.priority,
      controlCount: 0,
    });

    this.error = '';
    this.creatingTopic = true;
    this.topics = [optimisticTopic, ...this.topics];
    this.topicDraft = { title: '', description: '', mode: 'continuous', status: 'enabled', priority: 0 };
    this.showNewTopic = false;
    this.cdr.markForCheck();

    this.api
      .createControlTopic({
        title: draft.title,
        description: draft.description,
        mode: draft.mode,
        status: draft.status,
        priority: draft.priority,
        framework: this.framework || undefined,
      })
      .pipe(
        finalize(() => {
          this.creatingTopic = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: (topic) => {
          const index = this.topics.findIndex((item) => item.id === tempId);
          const createdTopic = this.toTopicView(topic);
          if (index >= 0) {
            this.topics[index] = createdTopic;
          } else {
            this.topics = [createdTopic, ...this.topics];
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.topics = this.topics.filter((item) => item.id !== tempId);
          this.topicDraft = { ...draft };
          this.showNewTopic = true;
          this.error = 'Unable to create topic.';
          this.cdr.markForCheck();
        },
      });
  }

  startEditTopic(topic: TopicView) {
    if (!this.isAdmin) return;
    this.editingTopicId = topic.id;
    this.topicEdit = {
      title: topic.title,
      description: topic.description || '',
      mode: topic.mode || 'continuous',
      status: topic.status || 'enabled',
      priority: typeof topic.priority === 'number' ? topic.priority : 0,
    };
  }

  cancelEditTopic() {
    this.editingTopicId = null;
    this.topicEdit = null;
  }

  saveTopic(topic: TopicView) {
    if (!this.isAdmin || !this.topicEdit) return;
    this.api
      .updateControlTopic(topic.id, {
        title: this.topicEdit.title.trim(),
        description: this.topicEdit.description.trim(),
        mode: this.topicEdit.mode,
        status: this.topicEdit.status,
        priority: this.topicEdit.priority,
      })
      .subscribe({
        next: (updated) => {
          Object.assign(topic, this.toTopicView(updated), {
            expanded: topic.expanded,
            loading: topic.loading,
            controls: topic.controls,
            page: topic.page,
            total: topic.total,
            showNewControl: topic.showNewControl,
            draftControl: topic.draftControl,
          });
          this.cancelEditTopic();
        },
        error: () => {
          this.error = 'Unable to update topic.';
        },
      });
  }

  deleteTopic(topic: TopicView) {
    if (!this.isAdmin) return;
    if (!confirm(`Delete topic ${topic.title}?`)) return;
    if (this.deletingTopicIds.has(topic.id)) return;

    const removeIndex = this.topics.findIndex((item) => item.id === topic.id);
    if (removeIndex < 0) return;
    const removedTopic = this.topics[removeIndex];
    this.topics = this.topics.filter((item) => item.id !== topic.id);
    this.closeTopicMenu();
    this.cdr.markForCheck();

    this.deletingTopicIds.add(topic.id);
    this.api
      .deleteControlTopic(topic.id)
      .pipe(
        finalize(() => {
          this.deletingTopicIds.delete(topic.id);
        }),
      )
      .subscribe({
        next: () => {},
        error: () => {
          if (!this.topics.some((item) => item.id === removedTopic.id)) {
            const next = [...this.topics];
            next.splice(Math.min(removeIndex, next.length), 0, removedTopic);
            this.topics = next;
          }
          this.error = 'Unable to delete topic.';
          this.cdr.markForCheck();
        },
      });
  }

  toggleTopicMenu(topicId: string, event?: MouseEvent) {
    event?.stopPropagation();
    this.openTopicMenuId = this.openTopicMenuId === topicId ? null : topicId;
  }

  closeTopicMenu() {
    this.openTopicMenuId = null;
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.closeTopicMenu();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closeTopicMenu();
  }

  toggleNewControl(topic: TopicView) {
    topic.showNewControl = !topic.showNewControl;
  }

  createControl(topic: TopicView) {
    if (!this.isAdmin) return;
    const controlCode = topic.draftControl.controlCode.trim();
    const title = topic.draftControl.title.trim();
    if (!controlCode || !title) return;

    this.api
      .createControlDefinition({
        topicId: topic.id,
        controlCode,
        title,
        description: '',
        isoMappings: this.parseList(topic.draftControl.isoMappingsText),
        status: topic.draftControl.status,
      })
      .subscribe({
        next: () => {
          topic.draftControl = this.emptyControlDraft(topic.id);
          topic.showNewControl = false;
          this.loadTopicControls(topic, true);
        },
        error: () => {
          this.error = 'Unable to create control.';
        },
      });
  }

  startEditControl(control: ControlDefinitionRecord) {
    if (!this.isAdmin) return;
    this.editingControlId = control.id;
    this.controlEdit = {
      topicId: control.topicId,
      controlCode: control.controlCode,
      title: control.title,
      isoMappingsText: Array.isArray(control.isoMappings) ? control.isoMappings.join(', ') : '',
      status: control.status || 'enabled',
    };
  }

  cancelEditControl() {
    this.editingControlId = null;
    this.controlEdit = null;
  }

  saveControl() {
    if (!this.isAdmin || !this.controlEdit || !this.editingControlId) return;
    const controlId = this.editingControlId;
    const previous = this.topics.find((topic) =>
      topic.controls.some((item) => item.id === controlId),
    );
    this.api
      .updateControlDefinition(controlId, {
        topicId: this.controlEdit.topicId,
        controlCode: this.controlEdit.controlCode.trim(),
        title: this.controlEdit.title.trim(),
        isoMappings: this.parseList(this.controlEdit.isoMappingsText),
        status: this.controlEdit.status,
      })
      .subscribe({
        next: () => {
          const newTopic = this.topics.find((topic) => topic.id === this.controlEdit?.topicId);
          if (previous) this.loadTopicControls(previous, true);
          if (newTopic && newTopic.id !== previous?.id && newTopic.expanded) {
            this.loadTopicControls(newTopic, true);
          }
          this.cancelEditControl();
        },
        error: () => {
          this.error = 'Unable to update control.';
        },
      });
  }

  parseList(value: string) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private toTopicView(topic: ControlTopic): TopicView {
    return {
      ...topic,
      expanded: false,
      loading: false,
      controls: [],
      page: 1,
      total: 0,
      showNewControl: false,
      draftControl: this.emptyControlDraft(topic.id),
    };
  }

  private emptyControlDraft(topicId: string): ControlForm {
    return {
      topicId,
      controlCode: '',
      title: '',
      isoMappingsText: '',
      status: 'enabled',
    };
  }
}
