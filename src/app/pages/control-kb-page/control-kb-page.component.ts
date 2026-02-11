import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
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
  complianceFilter = 'all';
  ownerRoleFilter = '';
  evidenceFilter = '';
  frameworkRefFilter = '';
  gapFilter = '';
  page = 1;
  pageSize = 10;
  pageSizeOptions = [10, 50, 100, 500];
  totalControls = 0;
  totalPages = 1;
  showNewTopic = false;
  showNewControl = false;
  showAssignControl = false;
  showNewComponent = false;
  showTopicManager = false;
  showFilters = false;
  topicPopoverControlId: string | null = null;
  frameworkPopoverControlId: string | null = null;
  relatedTopicId = '';
  frameworkMappingTarget = '';
  frameworkMappingCode = '';
  assignSearchTerm = '';
  assignResults: ControlDefinitionRecord[] = [];
  assignSelectedControlId = '';
  assignReferenceCode = '';
  assignSourceFramework = 'all';
  assignLoading = false;
  assignError = '';
  pendingTopicId = '';
  pendingFramework = '';
  pendingFrameworkRef = '';
  pendingGap = '';
  pendingCompliance = '';

  frameworkOptions: string[] = [];
  frameworkStatusMap = new Map<string, string>();
  private initialFrameworkAutoApplied = false;
  private noActiveFrameworkScope = false;

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
      this.pendingGap = String(params.get('gap') || '').trim();
      this.pendingCompliance = String(params.get('compliance') || params.get('complianceStatus') || '').trim();
      this.initialFrameworkAutoApplied = false;
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

  get canToggleActivation() {
    return this.isAdmin || this.isManager;
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
    if (this.statusFilter !== 'all') {
      const activationLabel = this.statusFilter === 'enabled' ? 'active' : 'inactive';
      chips.push({ label: 'Activation', value: activationLabel });
    }
    if (this.complianceFilter !== 'all') {
      const label = this.complianceFilter.replace(/_/g, ' ').toUpperCase();
      chips.push({ label: 'Compliance', value: label });
    }
    if (this.evidenceFilter.trim()) chips.push({ label: 'Evidence', value: this.evidenceFilter.trim() });
    if (this.ownerRoleFilter.trim()) chips.push({ label: 'Owner', value: this.ownerRoleFilter.trim() });
    if (this.frameworkRefFilter.trim()) chips.push({ label: 'Framework ref', value: this.frameworkRefFilter.trim() });
    if (this.gapFilter.trim()) chips.push({ label: 'Gap', value: this.formatGapLabel(this.gapFilter.trim()) });
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
        this.loadFrameworks(true);
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
    this.frameworkFilter = this.pendingFramework || 'all';
    this.frameworkRefFilter = this.pendingFrameworkRef || '';
    this.gapFilter = this.pendingGap || '';

    const normalizedCompliance = this.pendingCompliance
      .toUpperCase()
      .replace(/[\s-]+/g, '_')
      .trim();
    this.complianceFilter = ['COMPLIANT', 'PARTIAL', 'NOT_COMPLIANT', 'UNKNOWN'].includes(
      normalizedCompliance,
    )
      ? normalizedCompliance
      : 'all';

    if (!this.pendingTopicId) {
      this.topicFilter = 'all';
    } else {
      const found = this.topics.find((topic) => topic.id === this.pendingTopicId);
      this.topicFilter = found ? found.id : 'all';
    }

    this.pendingFramework = '';
    this.pendingTopicId = '';
    this.pendingFrameworkRef = '';
    this.pendingGap = '';
    this.pendingCompliance = '';
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

    if (this.noActiveFrameworkScope && this.frameworkFilter === 'all') {
      this.totalControls = 0;
      this.totalPages = 1;
      this.error = '';
      this.cdr.markForCheck();
      return;
    }

    this.api
      .listControlDefinitions({
        topicId: this.topicFilter !== 'all' ? this.topicFilter : undefined,
        query: this.searchTerm.trim() || undefined,
        status: this.statusFilter !== 'all' ? this.statusFilter : undefined,
        complianceStatus: this.complianceFilter !== 'all' ? this.complianceFilter : undefined,
        ownerRole: this.ownerRoleFilter.trim() || undefined,
        evidenceType: this.evidenceFilter.trim() || undefined,
        framework: this.frameworkFilter !== 'all' ? this.frameworkFilter : undefined,
        frameworkRef: this.frameworkRefFilter.trim() || undefined,
        gap: this.gapFilter.trim() || undefined,
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

  isControlEnabled(control: ControlDefinitionRecord) {
    return this.getControlStatusValue(control) === 'enabled';
  }

  toggleControlStatus(control: ControlDefinitionRecord, event?: Event) {
    event?.stopPropagation();
    if (!this.canToggleActivation) return;
    const nextStatus = this.isControlEnabled(control) ? 'disabled' : 'enabled';
    this.api
      .updateControlActivation(control.id, { status: nextStatus })
      .subscribe({
        next: () => {
          this.applyControlStatus(control.id, nextStatus);
          this.cdr.markForCheck();
        },
        error: () => {
          this.error = 'Unable to update control status.';
          this.cdr.markForCheck();
        },
      });
  }

  private applyControlStatus(controlId: string, status: string) {
    const normalizedStatus = status === 'disabled' ? 'disabled' : 'enabled';
    const shouldFilterOut = this.statusFilter !== 'all' && this.statusFilter !== normalizedStatus;

    if (shouldFilterOut) {
      const hadControl = this.controls.some((control) => control.id === controlId);
      this.controls = this.controls.filter((control) => control.id !== controlId);
      if (hadControl && this.totalControls > 0) {
        this.totalControls -= 1;
      }
      this.totalPages = Math.max(1, Math.ceil(this.totalControls / this.pageSize));
      if (this.selectedControl?.id === controlId) {
        this.selectedControl = undefined;
        this.controlEdit = null;
        this.editingControl = false;
      }
      return;
    }

    this.controls = this.controls.map((control) =>
      control.id === controlId ? { ...control, status: normalizedStatus } : control,
    );

    if (this.selectedControl?.id === controlId) {
      this.selectedControl = { ...this.selectedControl, status: normalizedStatus };
      if (this.controlEdit) {
        this.controlEdit = { ...this.controlEdit, status: normalizedStatus };
      }
    }
  }

  loadFrameworks(loadControlsAfter = false) {
    this.api.listFrameworks().subscribe({
      next: (frameworks) => {
        const list = frameworks || [];
        this.frameworkStatusMap = new Map(list.map((fw) => [fw.framework, fw.status]));
        const enabled = list.filter((fw) => fw.status === 'enabled').map((fw) => fw.framework).filter(Boolean);
        const names = enabled.length ? enabled : list.map((fw) => fw.framework).filter(Boolean);
        this.frameworkOptions = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));

        const activeFramework = list.find((fw) => fw.status === 'enabled')?.framework || '';
        const shouldAutoApplyActive =
          !this.initialFrameworkAutoApplied &&
          this.frameworkFilter === 'all' &&
          this.topicFilter === 'all' &&
          Boolean(activeFramework);

        this.noActiveFrameworkScope = !activeFramework && this.frameworkFilter === 'all';

        if (shouldAutoApplyActive) {
          this.frameworkFilter = activeFramework;
          this.page = 1;
          this.initialFrameworkAutoApplied = true;
          this.loadControls();
        } else if (loadControlsAfter) {
          this.loadControls();
        }

        if (this.selectedControl) {
          this.syncFrameworkMappingDraft(this.selectedControl);
        }

        this.cdr.markForCheck();
      },
      error: () => {
        this.frameworkOptions = [];
        this.frameworkStatusMap = new Map();
        this.noActiveFrameworkScope = false;
        if (loadControlsAfter) {
          this.loadControls();
        }
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
        this.syncFrameworkMappingDraft(full);
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
    const isoMappings = this.parseList(this.controlDraft.isoMappingsText);
    const frameworkCode = isoMappings[0] || controlCode;

    this.api
      .createControlDefinition({
        topicId: this.selectedTopic.id,
        controlCode,
        title,
        description: this.controlDraft.description.trim(),
        isoMappings,
        ownerRole: this.controlDraft.ownerRole.trim() || undefined,
        status: this.controlDraft.status,
        sortOrder: this.controlDraft.sortOrder,
        framework: this.frameworkFilter !== 'all' ? this.frameworkFilter : undefined,
        frameworkCode,
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

  formatGapLabel(value: string) {
    return value
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase());
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

  toggleAssignControl() {
    this.showAssignControl = !this.showAssignControl;
    this.assignError = '';
    if (!this.showAssignControl) {
      this.resetAssignControlDraft();
      return;
    }

    const target = this.resolveAssignTargetFramework();
    this.frameworkMappingTarget = target || '';
    this.assignReferenceCode = '';
    this.searchAssignableControls();
  }

  getFrameworkMappingLabel(mapping: { frameworkRef?: { externalId?: string | null; name?: string | null } | null; framework: string }) {
    return (mapping.frameworkRef?.externalId || mapping.frameworkRef?.name || mapping.framework || '').trim();
  }

  getAvailableFrameworkMappingOptions(control?: ControlDefinitionRecord) {
    const frameworkNames = Array.from(this.frameworkStatusMap.keys())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    if (!control) return frameworkNames;

    const mappedFrameworks = new Set(
      (control.frameworkMappings || [])
        .map((mapping) => String(mapping.framework || '').trim())
        .filter(Boolean),
    );

    return frameworkNames.filter((name) => !mappedFrameworks.has(name));
  }

  getAssignableFrameworkOptions() {
    return Array.from(this.frameworkStatusMap.keys())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  onAssignSourceFrameworkChange() {
    this.assignSelectedControlId = '';
    this.assignReferenceCode = '';
    this.searchAssignableControls();
  }

  resolveAssignTargetFramework() {
    if (this.frameworkFilter !== 'all') return this.frameworkFilter;
    return Array.from(this.frameworkStatusMap.entries()).find(([, status]) => status === 'enabled')?.[0] || '';
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
    const defaultCode = this.getDefaultFrameworkCode(selected);
    this.assignReferenceCode = defaultCode;
  }

  assignControl() {
    if (!this.canEdit) return;

    const targetFramework = this.resolveAssignTargetFramework();
    if (!targetFramework) {
      this.assignError = 'Select a framework filter first.';
      return;
    }

    const controlId = this.assignSelectedControlId.trim();
    if (!controlId) {
      this.assignError = 'Select a control to assign.';
      return;
    }

    const selected = this.assignResults.find((item) => item.id === controlId);
    const frameworkCode =
      this.assignReferenceCode.trim() || this.getDefaultFrameworkCode(selected) || selected?.controlCode || '';
    if (!frameworkCode) {
      this.assignError = 'Reference code is required.';
      return;
    }

    this.assignLoading = true;
    this.assignError = '';

    this.api
      .addControlFrameworkMapping(controlId, {
        framework: targetFramework,
        frameworkCode,
        relationshipType: 'RELATED',
      })
      .subscribe({
        next: (updated) => {
          if (this.topicFilter !== 'all') {
            this.api.addControlTopicMapping(controlId, this.topicFilter, 'RELATED').subscribe({
              next: (topicUpdated) => {
                this.finishAssignControl(topicUpdated || updated);
              },
              error: () => {
                this.assignLoading = false;
                this.assignError = 'Framework assigned, but failed to map topic.';
                this.cdr.markForCheck();
              },
            });
            return;
          }
          this.finishAssignControl(updated);
        },
        error: () => {
          this.assignLoading = false;
          this.assignError = 'Unable to assign control.';
          this.cdr.markForCheck();
        },
      });
  }

  addFrameworkMapping() {
    if (!this.canEdit || !this.selectedControl) return;

    const framework = this.frameworkMappingTarget.trim();
    if (!framework) return;

    const defaultCode = this.getDefaultFrameworkCode(this.selectedControl);
    const frameworkCode = this.frameworkMappingCode.trim() || defaultCode;

    this.api
      .addControlFrameworkMapping(this.selectedControl.id, {
        framework,
        frameworkCode,
        relationshipType: 'RELATED',
      })
      .subscribe({
        next: (updated) => {
          this.selectedControl = updated;
          this.controlEdit = this.mapControlForm(updated);
          this.updateControlInList(updated);
          this.syncFrameworkMappingDraft(updated);
          this.cdr.markForCheck();
        },
        error: () => {
          this.error = 'Unable to add framework mapping.';
          this.cdr.markForCheck();
        },
      });
  }

  removeFrameworkMapping(mappingId: string) {
    if (!this.canEdit || !this.selectedControl) return;

    this.api.removeControlFrameworkMapping(this.selectedControl.id, mappingId).subscribe({
      next: (updated) => {
        this.selectedControl = updated;
        this.controlEdit = this.mapControlForm(updated);
        this.updateControlInList(updated);
        this.syncFrameworkMappingDraft(updated);
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to remove framework mapping.';
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
      control.id === updated.id
        ? {
            ...control,
            topicMappings: updated.topicMappings,
            topic: updated.topic,
            frameworkMappings: updated.frameworkMappings,
            isoMappings: updated.isoMappings,
            status: updated.status,
            complianceStatus: updated.complianceStatus,
          }
        : control,
    );
  }

  clearFilters() {
    const activeFramework =
      Array.from(this.frameworkStatusMap.entries()).find(([, status]) => status === 'enabled')?.[0] || 'all';
    this.searchTerm = '';
    this.frameworkFilter = activeFramework;
    this.frameworkQuery = '';
    this.topicFilter = 'all';
    this.statusFilter = 'all';
    this.complianceFilter = 'all';
    this.ownerRoleFilter = '';
    this.evidenceFilter = '';
    this.frameworkRefFilter = '';
    this.gapFilter = '';
    this.frameworkPopoverControlId = null;
    this.topicPopoverControlId = null;
    this.showAssignControl = false;
    this.resetAssignControlDraft();
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
    return status === 'enabled' ? 'active' : 'inactive';
  }

  getControlStatusClass(control: ControlDefinitionRecord) {
    const status = this.getControlStatusValue(control);
    return status === 'enabled' ? 'status-enabled' : 'status-disabled';
  }

  getComplianceStatusLabel(control: ControlDefinitionRecord) {
    const status = this.getComplianceStatusValue(control);
    return status.replace('_', ' ');
  }

  getComplianceStatusClass(control: ControlDefinitionRecord) {
    const status = this.getComplianceStatusValue(control);
    if (status === 'COMPLIANT') return 'status-compliant';
    if (status === 'PARTIAL') return 'status-partial';
    if (status === 'NOT_COMPLIANT') return 'status-notcompliant';
    return 'status-unknown';
  }

  isFrameworkEnabled(control: ControlDefinitionRecord) {
    return this.getFrameworkStatusValue(control) === 'enabled';
  }

  getFrameworkStatusLabel(control: ControlDefinitionRecord) {
    const status = this.getFrameworkStatusValue(control);
    return status === 'enabled' ? 'enabled' : 'disabled';
  }

  getFrameworkStatusClass(control: ControlDefinitionRecord) {
    const status = this.getFrameworkStatusValue(control);
    return status === 'enabled' ? 'status-enabled' : 'status-disabled';
  }

  private getControlStatusValue(control: ControlDefinitionRecord) {
    return control.status === 'disabled' ? 'disabled' : 'enabled';
  }

  private getComplianceStatusValue(control: ControlDefinitionRecord) {
    const raw = String(control.complianceStatus || '').toUpperCase().replace(/\s+/g, '_');
    if (raw === 'COMPLIANT' || raw === 'PARTIAL' || raw === 'NOT_COMPLIANT' || raw === 'UNKNOWN') {
      return raw as 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN';
    }
    return 'UNKNOWN';
  }

  private getFrameworkStatusValue(control: ControlDefinitionRecord) {
    const mappings = control.frameworkMappings || [];
    if (!mappings.length) return 'disabled';
    if (!this.frameworkStatusMap.size) return 'enabled';
    const hasEnabled = mappings.some((mapping) => this.frameworkStatusMap.get(mapping.framework) === 'enabled');
    return hasEnabled ? 'enabled' : 'disabled';
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

  private getDefaultFrameworkCode(control?: ControlDefinitionRecord) {
    const fromIso = Array.isArray(control?.isoMappings) ? String(control?.isoMappings[0] || '').trim() : '';
    if (fromIso) return fromIso;
    return String(control?.controlCode || '').trim();
  }

  private syncFrameworkMappingDraft(control?: ControlDefinitionRecord) {
    if (!control) {
      this.frameworkMappingTarget = '';
      this.frameworkMappingCode = '';
      return;
    }

    const options = this.getAvailableFrameworkMappingOptions(control);
    if (!options.length) {
      this.frameworkMappingTarget = '';
    } else if (!options.includes(this.frameworkMappingTarget)) {
      this.frameworkMappingTarget = options[0];
    }

    if (!this.frameworkMappingCode.trim()) {
      this.frameworkMappingCode = this.getDefaultFrameworkCode(control);
    }
  }

  private finishAssignControl(updated: ControlDefinitionRecord) {
    this.assignLoading = false;
    this.showAssignControl = false;
    this.selectedControl = updated;
    this.controlEdit = this.mapControlForm(updated);
    this.resetAssignControlDraft();
    this.page = 1;
    this.loadControls();
    this.cdr.markForCheck();
  }

  private resetAssignControlDraft() {
    this.assignSearchTerm = '';
    this.assignResults = [];
    this.assignSelectedControlId = '';
    this.assignReferenceCode = '';
    this.assignSourceFramework = 'all';
    this.assignLoading = false;
    this.assignError = '';
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
