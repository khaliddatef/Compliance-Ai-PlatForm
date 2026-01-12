import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  ComplianceStandard,
  ControlDefinitionRecord,
  ControlTopic,
  TestComponentRecord,
} from '../../services/api.service';

type TopicForm = {
  title: string;
  description: string;
  mode: string;
  status: string;
  priority: number;
};

type ControlForm = {
  controlCode: string;
  title: string;
  description: string;
  isoMappingsText: string;
  ownerRole: string;
  status: string;
  sortOrder: number;
};

type ComponentForm = {
  requirement: string;
  evidenceTypesText: string;
  acceptanceCriteria: string;
  partialCriteria: string;
  rejectCriteria: string;
  sortOrder: number;
};

@Component({
  selector: 'app-control-kb-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './control-kb-page.component.html',
  styleUrl: './control-kb-page.component.css',
})
export class ControlKbPageComponent implements OnInit {
  standard: ComplianceStandard = 'ISO';
  topics: ControlTopic[] = [];
  controls: ControlDefinitionRecord[] = [];
  selectedTopic?: ControlTopic;
  selectedControl?: ControlDefinitionRecord;

  loading = true;
  error = '';
  searchTerm = '';
  page = 1;
  pageSize = 10;
  totalControls = 0;
  totalPages = 1;
  showNewTopic = false;
  showNewControl = false;
  showNewComponent = false;

  topicDraft: TopicForm = {
    title: '',
    description: '',
    mode: 'continuous',
    status: 'enabled',
    priority: 0,
  };
  topicEdit: TopicForm | null = null;
  editingTopic = false;

  controlDraft: ControlForm = {
    controlCode: '',
    title: '',
    description: '',
    isoMappingsText: '',
    ownerRole: '',
    status: 'enabled',
    sortOrder: 0,
  };
  controlEdit: ControlForm | null = null;
  editingControl = false;

  componentDraft: ComponentForm = {
    requirement: '',
    evidenceTypesText: '',
    acceptanceCriteria: '',
    partialCriteria: '',
    rejectCriteria: '',
    sortOrder: 0,
  };
  editingComponentId: string | null = null;
  componentEdit: ComponentForm | null = null;

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.refreshTopics();
  }

  refreshTopics() {
    this.loading = true;
    this.error = '';
    this.api.listControlTopics(this.standard).subscribe({
      next: (topics) => {
        this.topics = topics || [];
        this.loading = false;
        if (this.topics.length && !this.selectedTopic) {
          this.selectTopic(this.topics[0]);
        }
      },
      error: () => {
        this.error = 'Unable to load control topics.';
        this.loading = false;
      },
    });
  }

  selectTopic(topic: ControlTopic) {
    this.selectedTopic = topic;
    this.topicEdit = this.mapTopicForm(topic);
    this.editingTopic = false;
    this.page = 1;
    this.showNewControl = false;
    this.loadControls();
  }

  loadControls() {
    if (!this.selectedTopic) return;
    this.controls = [];
    this.selectedControl = undefined;
    this.controlEdit = null;
    this.editingControl = false;

    this.api
      .listControlDefinitions({
        standard: this.standard,
        topicId: this.selectedTopic.id,
        query: this.searchTerm.trim() || undefined,
        page: this.page,
        pageSize: this.pageSize,
      })
      .subscribe({
        next: (res) => {
          this.controls = res?.items || [];
          this.totalControls = res?.total || 0;
          this.totalPages = Math.max(1, Math.ceil(this.totalControls / (res?.pageSize || this.pageSize)));
        },
        error: () => {
          this.error = 'Unable to load controls.';
        },
      });
  }

  selectControl(control: ControlDefinitionRecord) {
    this.api.getControlDefinition(control.id).subscribe({
      next: (full) => {
        this.selectedControl = full;
        this.controlEdit = this.mapControlForm(full);
        this.editingControl = false;
        this.showNewComponent = false;
      },
      error: () => {
        this.error = 'Unable to load control details.';
      },
    });
  }

  createTopic() {
    const title = this.topicDraft.title.trim();
    if (!title) return;

    this.api
      .createControlTopic({
        standard: this.standard,
        title,
        description: this.topicDraft.description.trim(),
        mode: this.topicDraft.mode,
        status: this.topicDraft.status,
        priority: this.topicDraft.priority,
      })
      .subscribe({
        next: (topic) => {
          this.topics = [...this.topics, topic];
          this.topicDraft = { title: '', description: '', mode: 'continuous', status: 'enabled', priority: 0 };
          this.showNewTopic = false;
          this.selectTopic(topic);
        },
        error: () => {
          this.error = 'Unable to create topic.';
        },
      });
  }

  startEditTopic() {
    if (!this.topicEdit) return;
    this.editingTopic = true;
  }

  cancelEditTopic() {
    if (this.selectedTopic) {
      this.topicEdit = this.mapTopicForm(this.selectedTopic);
    }
    this.editingTopic = false;
  }

  saveTopic() {
    if (!this.selectedTopic || !this.topicEdit) return;
    this.api.updateControlTopic(this.selectedTopic.id, {
      title: this.topicEdit.title.trim(),
      description: this.topicEdit.description.trim(),
      mode: this.topicEdit.mode,
      status: this.topicEdit.status,
      priority: this.topicEdit.priority,
    })
    .subscribe({
      next: (updated) => {
        this.topics = this.topics.map((item) => (item.id === updated.id ? updated : item));
        this.selectedTopic = updated;
        this.topicEdit = this.mapTopicForm(updated);
        this.editingTopic = false;
      },
      error: () => {
        this.error = 'Unable to update topic.';
      },
    });
  }

  deleteTopic() {
    if (!this.selectedTopic) return;
    if (!confirm(`Delete topic ${this.selectedTopic.title}?`)) return;
    this.api.deleteControlTopic(this.selectedTopic.id).subscribe({
      next: () => {
        this.topics = this.topics.filter((item) => item.id !== this.selectedTopic?.id);
        this.selectedTopic = undefined;
        this.controls = [];
        this.selectedControl = undefined;
      },
      error: () => {
        this.error = 'Unable to delete topic.';
      },
    });
  }

  createControl() {
    if (!this.selectedTopic) return;
    const title = this.controlDraft.title.trim();
    const controlCode = this.controlDraft.controlCode.trim();
    if (!title || !controlCode) return;

    this.api
      .createControlDefinition({
        topicId: this.selectedTopic.id,
        controlCode,
        title,
        description: this.controlDraft.description.trim(),
        isoMappings: this.parseList(this.controlDraft.isoMappingsText),
        ownerRole: this.controlDraft.ownerRole.trim() || undefined,
        status: this.controlDraft.status,
        sortOrder: this.controlDraft.sortOrder,
      })
      .subscribe({
        next: () => {
          this.controlDraft = {
            controlCode: '',
            title: '',
            description: '',
            isoMappingsText: '',
            ownerRole: '',
            status: 'enabled',
            sortOrder: 0,
          };
          this.page = 1;
          this.showNewControl = false;
          this.loadControls();
        },
        error: () => {
          this.error = 'Unable to create control.';
        },
      });
  }

  startEditControl() {
    if (!this.controlEdit) return;
    this.editingControl = true;
  }

  cancelEditControl() {
    if (this.selectedControl) {
      this.controlEdit = this.mapControlForm(this.selectedControl);
    }
    this.editingControl = false;
  }

  saveControl() {
    if (!this.selectedControl || !this.controlEdit) return;
    this.api
      .updateControlDefinition(this.selectedControl.id, {
        controlCode: this.controlEdit.controlCode.trim(),
        title: this.controlEdit.title.trim(),
        description: this.controlEdit.description.trim(),
        isoMappings: this.parseList(this.controlEdit.isoMappingsText),
        ownerRole: this.controlEdit.ownerRole.trim() || undefined,
        status: this.controlEdit.status,
        sortOrder: this.controlEdit.sortOrder,
      })
      .subscribe({
        next: (updated) => {
          this.selectedControl = updated;
          this.controlEdit = this.mapControlForm(updated);
          this.editingControl = false;
          this.loadControls();
        },
        error: () => {
          this.error = 'Unable to update control.';
        },
      });
  }

  deleteControl() {
    if (!this.selectedControl) return;
    if (!confirm(`Delete control ${this.selectedControl.controlCode}?`)) return;
    this.api.deleteControlDefinition(this.selectedControl.id).subscribe({
      next: () => {
        this.loadControls();
      },
      error: () => {
        this.error = 'Unable to delete control.';
      },
    });
  }

  goToPage(nextPage: number) {
    const clamped = Math.min(Math.max(nextPage, 1), this.totalPages);
    if (clamped === this.page) return;
    this.page = clamped;
    this.loadControls();
  }

  nextPage() {
    this.goToPage(this.page + 1);
  }

  prevPage() {
    this.goToPage(this.page - 1);
  }

  get pageNumbers() {
    const total = this.totalPages;
    const current = this.page;
    const range = 5;
    const start = Math.max(1, current - 2);
    const end = Math.min(total, start + range - 1);
    const adjustedStart = Math.max(1, end - range + 1);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }

  createTestComponent() {
    if (!this.selectedControl) return;
    const requirement = this.componentDraft.requirement.trim();
    if (!requirement) return;

    this.api
      .createTestComponent(this.selectedControl.id, {
        requirement,
        evidenceTypes: this.parseList(this.componentDraft.evidenceTypesText),
        acceptanceCriteria: this.componentDraft.acceptanceCriteria.trim() || undefined,
        partialCriteria: this.componentDraft.partialCriteria.trim() || undefined,
        rejectCriteria: this.componentDraft.rejectCriteria.trim() || undefined,
        sortOrder: this.componentDraft.sortOrder,
      })
      .subscribe({
        next: () => {
          this.componentDraft = {
            requirement: '',
            evidenceTypesText: '',
            acceptanceCriteria: '',
            partialCriteria: '',
            rejectCriteria: '',
            sortOrder: 0,
          };
          this.showNewComponent = false;
          this.reloadSelectedControl();
        },
        error: () => {
          this.error = 'Unable to create test component.';
        },
      });
  }

  startEditComponent(component: TestComponentRecord) {
    this.editingComponentId = component.id;
    this.componentEdit = {
      requirement: component.requirement,
      evidenceTypesText: this.formatEvidence(component),
      acceptanceCriteria: component.acceptanceCriteria || '',
      partialCriteria: component.partialCriteria || '',
      rejectCriteria: component.rejectCriteria || '',
      sortOrder: component.sortOrder || 0,
    };
  }

  cancelEditComponent() {
    this.editingComponentId = null;
    this.componentEdit = null;
  }

  saveComponent(component: TestComponentRecord) {
    if (!this.componentEdit) return;
    this.api.updateTestComponent(component.id, {
      requirement: this.componentEdit.requirement.trim(),
      evidenceTypes: this.parseList(this.componentEdit.evidenceTypesText),
      acceptanceCriteria: this.componentEdit.acceptanceCriteria.trim() || undefined,
      partialCriteria: this.componentEdit.partialCriteria.trim() || undefined,
      rejectCriteria: this.componentEdit.rejectCriteria.trim() || undefined,
      sortOrder: this.componentEdit.sortOrder,
    })
    .subscribe({
      next: () => {
        this.editingComponentId = null;
        this.componentEdit = null;
        this.reloadSelectedControl();
      },
      error: () => {
        this.error = 'Unable to update test component.';
      },
    });
  }

  deleteComponent(component: TestComponentRecord) {
    if (!confirm('Delete this test component?')) return;
    this.api.deleteTestComponent(component.id).subscribe({
      next: () => {
        this.reloadSelectedControl();
      },
      error: () => {
        this.error = 'Unable to delete test component.';
      },
    });
  }

  reloadSelectedControl() {
    if (!this.selectedControl) return;
    this.selectControl(this.selectedControl);
  }

  formatEvidence(component: TestComponentRecord) {
    const raw = component.evidenceTypes;
    if (Array.isArray(raw)) {
      return raw
        .map((entry) => {
          if (!entry) return '';
          if (typeof entry === 'string') return entry;
          if (typeof entry === 'object' && 'name' in entry) return String((entry as any).name || '');
          return '';
        })
        .filter(Boolean)
        .join(', ');
    }
    if (typeof raw === 'string') return raw;
    return '';
  }

  parseList(value: string) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  searchControls() {
    this.page = 1;
    this.loadControls();
  }

  mapTopicForm(topic: ControlTopic): TopicForm {
    return {
      title: topic.title,
      description: topic.description || '',
      mode: topic.mode || 'continuous',
      status: topic.status || 'enabled',
      priority: typeof topic.priority === 'number' ? topic.priority : 0,
    };
  }

  mapControlForm(control: ControlDefinitionRecord): ControlForm {
    return {
      controlCode: control.controlCode,
      title: control.title,
      description: control.description || '',
      isoMappingsText: Array.isArray(control.isoMappings) ? control.isoMappings.join(', ') : '',
      ownerRole: control.ownerRole || '',
      status: control.status || 'enabled',
      sortOrder: typeof control.sortOrder === 'number' ? control.sortOrder : 0,
    };
  }
}
