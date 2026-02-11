import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ApiService,
  ControlDefinitionRecord,
  ControlTopic,
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
  showTopicManager = false;
  showFilters = false;
  topicPopoverControlId: string | null = null;
  frameworkPopoverControlId: string | null = null;
  pendingTopicId = '';
  pendingFramework = '';
  pendingFrameworkRef = '';
  pendingGap = '';
  pendingCompliance = '';

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

    this.gapFilter = this.pendingGap;
    if (this.pendingCompliance) {
      const normalized = this.pendingCompliance
        .toUpperCase()
        .replace(/[\s-]+/g, '_')
        .trim();
      if (['COMPLIANT', 'PARTIAL', 'NOT_COMPLIANT', 'UNKNOWN'].includes(normalized)) {
        this.complianceFilter = normalized;
      }
    }

    if (this.pendingTopicId) {
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
    this.topicPopoverControlId = null;
    this.frameworkPopoverControlId = null;

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
      return;
    }

    this.controls = this.controls.map((control) =>
      control.id === controlId ? { ...control, status: normalizedStatus } : control,
    );
  }

  loadFrameworks() {
    this.api.listFrameworks().subscribe({
      next: (frameworks) => {
        const list = frameworks || [];
        this.frameworkStatusMap = new Map(list.map((fw) => [fw.framework, fw.status]));
        const enabled = list.filter((fw) => fw.status === 'enabled').map((fw) => fw.framework).filter(Boolean);
        const names = enabled.length ? enabled : list.map((fw) => fw.framework).filter(Boolean);
        this.frameworkOptions = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
        this.cdr.markForCheck();
      },
      error: () => {
        this.frameworkOptions = [];
        this.frameworkStatusMap = new Map();
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
        framework: this.frameworkFilter !== 'all' ? this.frameworkFilter : undefined,
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

  clearFilters() {
    this.searchTerm = '';
    this.frameworkFilter = 'all';
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

  get filteredFrameworkOptions() {
    const query = this.frameworkQuery.trim().toLowerCase();
    if (!query) return this.frameworkOptions;
    return this.frameworkOptions.filter((name) => name.toLowerCase().includes(query));
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
