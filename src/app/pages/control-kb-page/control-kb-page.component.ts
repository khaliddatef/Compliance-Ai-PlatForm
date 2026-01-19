import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ApiService,
  ControlDefinitionRecord,
  ControlTopic,
  TestComponentRecord,
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

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
  topics: ControlTopic[] = [];
  controls: ControlDefinitionRecord[] = [];
  selectedTopic?: ControlTopic;
  selectedControl?: ControlDefinitionRecord;

  loading = true;
  error = '';
  searchTerm = '';
  frameworkFilter = 'all';
  frameworkQuery = '';
  topicFilter = 'all';
  statusFilter = 'all';
  ownerRoleFilter = '';
  evidenceFilter = '';
  frameworkRefFilter = '';
  page = 1;
  pageSize = 10;
  pageSizeOptions = [10, 50, 100, 500];
  totalControls = 0;
  totalPages = 1;
  showNewTopic = false;
  showNewControl = false;
  showNewComponent = false;
  showTopicManager = false;
  showFilters = false;
  topicPopoverControlId: string | null = null;
  frameworkPopoverControlId: string | null = null;
  relatedTopicId = '';
  pendingTopicId = '';
  pendingFramework = '';
  pendingFrameworkRef = '';

  frameworkOptions: string[] = [];
  frameworkStatusMap = new Map<string, string>();

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

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.route.queryParamMap.subscribe((params) => {
      this.pendingTopicId = String(params.get('topicId') || '').trim();
      this.pendingFramework = String(params.get('framework') || '').trim();
      this.pendingFrameworkRef = String(params.get('frameworkRef') || '').trim();
      this.refreshTopics();
    });
  }

  get isAdmin() {
    return this.auth.user()?.role === 'ADMIN';
  }

  get isManager() {
    return this.auth.user()?.role === 'MANAGER';
  }

  get canEdit() {
    return this.isAdmin;
  }

  get activeFilterChips() {
    const chips: Array<{ label: string; value: string }> = [];
    const search = this.searchTerm.trim();
    if (search) chips.push({ label: 'Search', value: search });
    if (this.frameworkFilter !== 'all') chips.push({ label: 'Framework', value: this.frameworkFilter });
    if (this.topicFilter !== 'all') {
      const topic = this.topics.find((item) => item.id === this.topicFilter);
      chips.push({ label: 'Topic', value: topic?.title || this.topicFilter });
    }
    if (this.statusFilter !== 'all') chips.push({ label: 'Status', value: this.statusFilter });
    if (this.evidenceFilter.trim()) chips.push({ label: 'Evidence', value: this.evidenceFilter.trim() });
    if (this.ownerRoleFilter.trim()) chips.push({ label: 'Owner', value: this.ownerRoleFilter.trim() });
    if (this.frameworkRefFilter.trim()) chips.push({ label: 'Framework ref', value: this.frameworkRefFilter.trim() });
    return chips;
  }

  refreshTopics() {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();
    this.api.listControlTopics().subscribe({
      next: (topics) => {
        this.topics = topics || [];
        this.applyQueryFilters();
        this.loading = false;
        this.syncSelectedTopic();
        this.loadFrameworks();
        this.loadControls();
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to load control topics.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private applyQueryFilters() {
    if (this.pendingFramework) {
      this.frameworkFilter = this.pendingFramework;
    }

    if (this.pendingFrameworkRef) {
      this.frameworkRefFilter = this.pendingFrameworkRef;
    }

    if (this.pendingTopicId) {
      const found = this.topics.find((topic) => topic.id === this.pendingTopicId);
      this.topicFilter = found ? found.id : 'all';
    }

    this.pendingFramework = '';
    this.pendingTopicId = '';
    this.pendingFrameworkRef = '';
  }

  selectTopic(topic: ControlTopic) {
    this.selectedTopic = topic;
    this.topicEdit = this.mapTopicForm(topic);
    this.editingTopic = false;
    this.topicFilter = topic.id;
    this.page = 1;
    this.showNewControl = false;
    this.loadControls();
  }

  loadControls() {
    this.controls = [];
    this.selectedControl = undefined;
    this.controlEdit = null;
    this.editingControl = false;
    this.topicPopoverControlId = null;
    this.frameworkPopoverControlId = null;

    this.api
      .listControlDefinitions({
        topicId: this.topicFilter !== 'all' ? this.topicFilter : undefined,
        query: this.searchTerm.trim() || undefined,
        status: this.statusFilter !== 'all' ? this.statusFilter : undefined,
        ownerRole: this.ownerRoleFilter.trim() || undefined,
        evidenceType: this.evidenceFilter.trim() || undefined,
        framework: this.frameworkFilter !== 'all' ? this.frameworkFilter : undefined,
        frameworkRef: this.frameworkRefFilter.trim() || undefined,
        page: this.page,
        pageSize: this.pageSize,
      })
      .subscribe({
        next: (res) => {
          this.controls = res?.items || [];
          this.totalControls = res?.total || 0;
          this.totalPages = Math.max(1, Math.ceil(this.totalControls / (res?.pageSize || this.pageSize)));
          if (this.selectedControl && !this.controls.some((item) => item.id === this.selectedControl?.id)) {
            this.selectedControl = undefined;
            this.controlEdit = null;
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.error = 'Unable to load controls.';
          this.cdr.markForCheck();
        },
      });
  }

  loadFrameworks() {
    this.api.listFrameworks().subscribe({
      next: (frameworks) => {
        const list = frameworks || [];
        const names = list.map((fw) => fw.framework).filter(Boolean);
        this.frameworkOptions = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
        this.frameworkStatusMap = new Map(list.map((fw) => [fw.framework, fw.status]));
        this.cdr.markForCheck();
      },
      error: () => {
        this.frameworkOptions = [];
        this.frameworkStatusMap = new Map();
        this.cdr.markForCheck();
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
        this.relatedTopicId = '';
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to load control details.';
        this.cdr.markForCheck();
      },
    });
  }

  createTopic() {
    if (!this.canEdit) return;
    const title = this.topicDraft.title.trim();
    if (!title) return;

    this.api
      .createControlTopic({
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
          this.cdr.markForCheck();
        },
        error: () => {
          this.error = 'Unable to create topic.';
          this.cdr.markForCheck();
        },
      });
  }

  startEditTopic() {
    if (!this.canEdit) return;
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
    if (!this.canEdit) return;
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
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to update topic.';
        this.cdr.markForCheck();
      },
    });
  }

  deleteTopic() {
    if (!this.canEdit) return;
    if (!this.selectedTopic) return;
    if (!confirm(`Delete topic ${this.selectedTopic.title}?`)) return;
    this.api.deleteControlTopic(this.selectedTopic.id).subscribe({
      next: () => {
        this.topics = this.topics.filter((item) => item.id !== this.selectedTopic?.id);
        this.selectedTopic = undefined;
        this.controls = [];
        this.selectedControl = undefined;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to delete topic.';
        this.cdr.markForCheck();
      },
    });
  }

  createControl() {
    if (!this.canEdit) return;
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
          this.cdr.markForCheck();
        },
        error: () => {
          this.error = 'Unable to create control.';
          this.cdr.markForCheck();
        },
      });
  }

  startEditControl() {
    if (!this.canEdit) return;
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
    if (!this.canEdit) return;
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
          this.cdr.markForCheck();
        },
        error: () => {
          this.error = 'Unable to update control.';
          this.cdr.markForCheck();
        },
      });
  }

  deleteControl() {
    if (!this.canEdit) return;
    if (!this.selectedControl) return;
    if (!confirm(`Delete control ${this.selectedControl.controlCode}?`)) return;
    this.api.deleteControlDefinition(this.selectedControl.id).subscribe({
      next: () => {
        this.loadControls();
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to delete control.';
        this.cdr.markForCheck();
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
    if (!this.canEdit) return;
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
          this.cdr.markForCheck();
        },
        error: () => {
          this.error = 'Unable to create test component.';
          this.cdr.markForCheck();
        },
      });
  }

  startEditComponent(component: TestComponentRecord) {
    if (!this.canEdit) return;
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
    if (!this.canEdit) return;
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
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to update test component.';
        this.cdr.markForCheck();
      },
    });
  }

  deleteComponent(component: TestComponentRecord) {
    if (!this.canEdit) return;
    if (!confirm('Delete this test component?')) return;
    this.api.deleteTestComponent(component.id).subscribe({
      next: () => {
        this.reloadSelectedControl();
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to delete test component.';
        this.cdr.markForCheck();
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

  applyFilters() {
    this.page = 1;
    this.syncSelectedTopic();
    this.loadControls();
  }

  updatePageSize(value: number | string) {
    const next = Number(value) || 10;
    if (next === this.pageSize) return;
    this.pageSize = next;
    this.page = 1;
    this.loadControls();
  }

  toggleTopicPopover(control: ControlDefinitionRecord, event?: Event) {
    event?.stopPropagation();
    this.topicPopoverControlId = this.topicPopoverControlId === control.id ? null : control.id;
  }

  toggleFrameworkPopover(control: ControlDefinitionRecord, event?: Event) {
    event?.stopPropagation();
    this.frameworkPopoverControlId = this.frameworkPopoverControlId === control.id ? null : control.id;
  }

  getControlTopicMappings(control: ControlDefinitionRecord) {
    const mappings = (control.topicMappings || []).map((mapping) => ({
      topicId: mapping.topicId,
      title: mapping.topic?.title || '—',
      relationshipType: mapping.relationshipType,
    }));
    if (!mappings.length && control.topic) {
      return [{ topicId: control.topic.id, title: control.topic.title, relationshipType: 'PRIMARY' as const }];
    }
    return mappings;
  }

  getRelatedTopicCount(control: ControlDefinitionRecord) {
    return this.getControlTopicMappings(control).filter((mapping) => mapping.relationshipType === 'RELATED').length;
  }

  getPrimaryTopicLabel(control: ControlDefinitionRecord) {
    const primary = this.getControlTopicMappings(control).find((mapping) => mapping.relationshipType === 'PRIMARY');
    return primary?.title || control.topic?.title || '—';
  }

  getPrimaryTopicMapping(control?: ControlDefinitionRecord) {
    if (!control) return null;
    return this.getControlTopicMappings(control).find((mapping) => mapping.relationshipType === 'PRIMARY') || null;
  }

  getRelatedTopicMappings(control?: ControlDefinitionRecord) {
    if (!control) return [];
    return this.getControlTopicMappings(control).filter((mapping) => mapping.relationshipType === 'RELATED');
  }

  addRelatedTopic() {
    if (!this.canEdit || !this.selectedControl) return;
    const topicId = this.relatedTopicId;
    if (!topicId) return;
    this.api.addControlTopicMapping(this.selectedControl.id, topicId, 'RELATED').subscribe({
      next: (updated) => {
        this.selectedControl = updated;
        this.controlEdit = this.mapControlForm(updated);
        this.updateControlInList(updated);
        this.relatedTopicId = '';
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to add related topic.';
        this.cdr.markForCheck();
      },
    });
  }

  removeRelatedTopic(topicId: string) {
    if (!this.canEdit || !this.selectedControl) return;
    this.api.removeControlTopicMapping(this.selectedControl.id, topicId).subscribe({
      next: (updated) => {
        this.selectedControl = updated;
        this.controlEdit = this.mapControlForm(updated);
        this.updateControlInList(updated);
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to remove related topic.';
        this.cdr.markForCheck();
      },
    });
  }

  getAvailableRelatedTopics() {
    if (!this.selectedControl) return this.topics;
    const mapped = new Set((this.selectedControl.topicMappings || []).map((mapping) => mapping.topicId));
    mapped.add(this.selectedControl.topicId);
    return this.topics.filter((topic) => !mapped.has(topic.id));
  }

  private updateControlInList(updated: ControlDefinitionRecord) {
    this.controls = this.controls.map((control) =>
      control.id === updated.id ? { ...control, topicMappings: updated.topicMappings, topic: updated.topic } : control,
    );
  }

  clearFilters() {
    this.searchTerm = '';
    this.frameworkFilter = 'all';
    this.frameworkQuery = '';
    this.topicFilter = 'all';
    this.statusFilter = 'all';
    this.ownerRoleFilter = '';
    this.evidenceFilter = '';
    this.frameworkRefFilter = '';
    this.frameworkPopoverControlId = null;
    this.topicPopoverControlId = null;
    this.page = 1;
    this.syncSelectedTopic();
    this.loadControls();
  }

  getControlFrameworkLabels(control: ControlDefinitionRecord) {
    const labels = (control.frameworkMappings || [])
      .map((mapping) => {
        const ref = mapping.frameworkRef;
        return (ref?.externalId || ref?.name || mapping.framework || '').trim();
      })
      .filter(Boolean);
    return Array.from(new Set(labels)).sort((a, b) => a.localeCompare(b));
  }

  getControlFrameworkCount(control: ControlDefinitionRecord) {
    return this.getControlFrameworkLabels(control).length;
  }

  getControlReferenceCodes(control: ControlDefinitionRecord) {
    const codes = new Set<string>();
    for (const mapping of control.frameworkMappings || []) {
      if (mapping.frameworkCode) codes.add(mapping.frameworkCode);
    }
    for (const item of control.isoMappings || []) {
      if (item) codes.add(item);
    }
    const list = Array.from(codes);
    if (!list.length) return '—';
    if (list.length <= 2) return list.join(', ');
    return `${list.slice(0, 2).join(', ')} +${list.length - 2}`;
  }

  getControlIndex(index: number) {
    return (this.page - 1) * this.pageSize + index + 1;
  }

  getControlStatusLabel(control: ControlDefinitionRecord) {
    const status = this.getControlStatusValue(control);
    return status === 'enabled' ? 'enabled' : 'disabled';
  }

  getControlStatusClass(control: ControlDefinitionRecord) {
    const status = this.getControlStatusValue(control);
    return status === 'enabled' ? 'status-enabled' : 'status-disabled';
  }

  private getControlStatusValue(control: ControlDefinitionRecord) {
    if (this.frameworkFilter !== 'all') {
      const status = this.getFrameworkStatus(this.frameworkFilter);
      return status || 'disabled';
    }

    const mappings = control.frameworkMappings || [];
    if (!mappings.length) return control.status || 'enabled';
    const hasEnabled = mappings.some((mapping) => this.getFrameworkStatus(mapping.framework) === 'enabled');
    return hasEnabled ? 'enabled' : 'disabled';
  }

  private getFrameworkStatus(name: string) {
    return this.frameworkStatusMap.get(name) || null;
  }

  openControlPage(control: ControlDefinitionRecord, event?: Event) {
    event?.stopPropagation();
    this.router.navigate(['/control-kb', control.id]);
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

  getEvidenceTypes() {
    const components = this.selectedControl?.testComponents || [];
    const evidence = components.flatMap((component) => this.extractEvidenceTypes(component.evidenceTypes));
    return Array.from(new Set(evidence)).filter(Boolean);
  }

  getAcceptanceRules() {
    const components = this.selectedControl?.testComponents || [];
    const rules = components.map((item) => item.acceptanceCriteria).filter(Boolean) as string[];
    return Array.from(new Set(rules));
  }

  getPartialRules() {
    const components = this.selectedControl?.testComponents || [];
    const rules = components.map((item) => item.partialCriteria).filter(Boolean) as string[];
    return Array.from(new Set(rules));
  }

  getRejectRules() {
    const components = this.selectedControl?.testComponents || [];
    const rules = components.map((item) => item.rejectCriteria).filter(Boolean) as string[];
    return Array.from(new Set(rules));
  }

  get filteredFrameworkOptions() {
    const query = this.frameworkQuery.trim().toLowerCase();
    if (!query) return this.frameworkOptions;
    return this.frameworkOptions.filter((name) => name.toLowerCase().includes(query));
  }

  private extractEvidenceTypes(raw: unknown) {
    if (Array.isArray(raw)) {
      return raw
        .map((entry) => {
          if (!entry) return '';
          if (typeof entry === 'string') return entry.trim();
          if (typeof entry === 'object' && 'name' in entry) return String((entry as any).name || '').trim();
          return '';
        })
        .filter(Boolean);
    }
    if (typeof raw === 'string') {
      return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }

  private syncSelectedTopic() {
    if (this.topicFilter === 'all') {
      this.selectedTopic = undefined;
      this.topicEdit = null;
      this.editingTopic = false;
      return;
    }

    const found = this.topics.find((topic) => topic.id === this.topicFilter);
    if (found) {
      this.selectedTopic = found;
      this.topicEdit = this.mapTopicForm(found);
      this.editingTopic = false;
    } else {
      this.selectedTopic = undefined;
      this.topicEdit = null;
      this.topicFilter = 'all';
      this.editingTopic = false;
    }
  }
}
