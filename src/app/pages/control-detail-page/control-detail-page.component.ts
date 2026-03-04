import { CommonModule, Location } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ApiService,
  ControlDefinitionRecord,
  ControlFrameworkMappingRecord,
  ControlStatusPayload,
  FrameworkSummary,
  TestComponentRecord,
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

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
  selector: 'app-control-detail-page',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './control-detail-page.component.html',
  styleUrl: './control-detail-page.component.css',
})
export class ControlDetailPageComponent implements OnInit {
  control?: ControlDefinitionRecord;
  controlEdit: ControlForm | null = null;
  activeFramework?: FrameworkSummary | null;
  backQueryParams: Record<string, string> = {};
  private activeReferenceCodes = new Set<string>();
  loading = true;
  error = '';
  editingControl = false;
  statusLoading = false;
  statusError = '';
  controlStatus: ControlStatusPayload | null = null;
  actionNotice = '';
  actionBusy = false;
  whyPanelOpen = false;

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly location: Location,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.loadActiveFramework();
    this.route.queryParamMap.subscribe((params) => {
      const topicId = String(params.get('topicId') || '').trim();
      const framework = String(params.get('framework') || '').trim();
      const nextQuery: Record<string, string> = {};
      if (topicId) nextQuery['topicId'] = topicId;
      if (framework) nextQuery['framework'] = framework;
      this.backQueryParams = nextQuery;
      this.cdr.markForCheck();
    });
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (!id) return;
      this.fetchControl(id);
    });
  }

  get isAdmin() {
    return this.auth.user()?.role === 'ADMIN';
  }

  get canEdit() {
    return this.isAdmin;
  }

  get canOperateControl() {
    const role = this.auth.user()?.role;
    return role === 'ADMIN' || role === 'MANAGER';
  }

  get statusLabel() {
    return this.control?.status === 'disabled' ? 'disabled' : 'enabled';
  }

  get statusClass() {
    return this.control?.status === 'disabled' ? 'status-disabled' : 'status-enabled';
  }

  get primaryTopicLabel() {
    return this.getPrimaryTopic()?.title || this.control?.topic?.title || '—';
  }

  get relatedTopics() {
    return this.getTopicMappings()
      .filter((mapping) => mapping.relationshipType === 'RELATED')
      .map((mapping) => mapping.title);
  }

  get controlComplianceLabel() {
    const status = this.controlStatus?.complianceStatus || 'NOT_ASSESSED';
    if (status === 'PASS') return 'Pass';
    if (status === 'PARTIAL') return 'Partial';
    if (status === 'FAIL') return 'Fail';
    return 'Not assessed';
  }

  get controlComplianceClass() {
    const status = this.controlStatus?.complianceStatus || 'NOT_ASSESSED';
    if (status === 'PASS') return 'compliance-pass';
    if (status === 'PARTIAL') return 'compliance-partial';
    if (status === 'FAIL') return 'compliance-fail';
    return 'compliance-not-assessed';
  }

  fetchControl(id: string) {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();
    this.api.getControlDefinition(id).subscribe({
      next: (control) => {
        this.control = control || undefined;
        this.controlEdit = this.control ? this.mapControlForm(this.control) : null;
        this.editingControl = false;
        this.rebuildActiveReferenceCodes();
        this.statusError = '';
        this.actionNotice = '';
        if (this.control?.id) {
          this.fetchControlStatus(this.control.id);
        } else {
          this.controlStatus = null;
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to load control details.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
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

  startEditControl() {
    if (!this.canEdit || !this.controlEdit) return;
    this.editingControl = true;
  }

  cancelEditControl() {
    if (!this.control) return;
    this.controlEdit = this.mapControlForm(this.control);
    this.editingControl = false;
  }

  saveControl() {
    if (!this.canEdit || !this.control || !this.controlEdit) return;
    const controlId = this.control.id;
    const payload = {
      controlCode: this.controlEdit.controlCode.trim(),
      title: this.controlEdit.title.trim(),
      description: this.controlEdit.description.trim(),
      isoMappings: this.parseList(this.controlEdit.isoMappingsText),
      ownerRole: this.controlEdit.ownerRole.trim() || undefined,
      status: this.controlEdit.status,
      sortOrder: this.controlEdit.sortOrder,
    };

    this.api.updateControlDefinition(controlId, payload).subscribe({
      next: () => {
        // PATCH response does not always include nested relations (testComponents, mappings).
        // Reload the full control payload so the detail view remains consistent after save.
        this.fetchControl(controlId);
      },
      error: () => {
        this.error = 'Unable to update control.';
        this.cdr.markForCheck();
      },
    });
  }

  deleteControl() {
    if (!this.canEdit || !this.control) return;
    if (!confirm(`Delete control ${this.control.controlCode}?`)) return;
    this.api.deleteControlDefinition(this.control.id).subscribe({
      next: () => {
        this.router.navigate(['/control-kb'], {
          queryParams: this.backQueryParams,
        });
      },
      error: () => {
        this.error = 'Unable to delete control.';
        this.cdr.markForCheck();
      },
    });
  }

  goBack() {
    if (window.history.length > 1) {
      this.location.back();
      return;
    }
    this.router.navigate(['/control-kb'], { queryParams: this.backQueryParams });
  }

  requestEvidenceFromBanner() {
    if (!this.canOperateControl || !this.control?.id || this.actionBusy) return;
    const dueDate = new Date(Date.now() + 14 * 86400000).toISOString();
    this.actionBusy = true;
    this.actionNotice = '';
    this.api.requestControlEvidence(
      this.control.id,
      {
        dueDate,
      },
      crypto.randomUUID(),
    ).subscribe({
      next: (res) => {
        const created = Number(res?.result?.createdCount || 0);
        const existing = Number(res?.result?.existingCount || 0);
        this.actionNotice = `Evidence requests synced. Created: ${created}, existing: ${existing}.`;
        if (this.control?.id) this.fetchControlStatus(this.control.id);
      },
      error: () => {
        this.actionNotice = 'Unable to create evidence requests.';
      },
      complete: () => {
        this.actionBusy = false;
        this.cdr.markForCheck();
      },
    });
  }

  runAssessmentFromBanner() {
    this.actionNotice = 'Assessment is currently manual/AI-assisted through chat.';
    this.cdr.markForCheck();
  }

  createRemediationFromBanner() {
    if (!this.canOperateControl || !this.control || this.actionBusy) return;
    this.actionBusy = true;
    this.actionNotice = '';
    this.api.executeCopilotAction(
      {
        actionType: 'CREATE_REMEDIATION_TASK',
        payload: {
          title: `Remediate ${this.control.controlCode} - ${this.control.title}`,
          controlId: this.control.id,
        },
        dryRun: false,
      },
      crypto.randomUUID(),
    ).subscribe({
      next: () => {
        this.actionNotice = 'Remediation task created.';
        if (this.control?.id) this.fetchControlStatus(this.control.id);
      },
      error: () => {
        this.actionNotice = 'Unable to create remediation task.';
      },
      complete: () => {
        this.actionBusy = false;
        this.cdr.markForCheck();
      },
    });
  }

  addToAuditPackFromBanner() {
    if (!this.canOperateControl || this.actionBusy) return;
    this.actionBusy = true;
    this.actionNotice = '';
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 90 * 86400000);
    this.api.generateAuditPack({
      frameworkId: this.activeFramework?.framework || undefined,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    }).subscribe({
      next: (res) => {
        const packId = String(res?.pack?.id || '');
        this.actionNotice = packId
          ? `Audit pack generated: ${packId}`
          : 'Audit pack generated.';
      },
      error: () => {
        this.actionNotice = 'Unable to generate audit pack.';
      },
      complete: () => {
        this.actionBusy = false;
        this.cdr.markForCheck();
      },
    });
  }

  formatDate(value?: string | null) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString();
  }

  toggleWhyPanel() {
    this.whyPanelOpen = !this.whyPanelOpen;
  }

  private getTopicMappings() {
    const mappings = (this.control?.topicMappings || []).map((mapping) => ({
      topicId: mapping.topicId,
      title: mapping.topic?.title || '—',
      relationshipType: mapping.relationshipType,
    }));
    if (!mappings.length && this.control?.topic) {
      return [{ topicId: this.control.topic.id, title: this.control.topic.title, relationshipType: 'PRIMARY' as const }];
    }
    return mappings;
  }

  private getPrimaryTopic() {
    return this.getTopicMappings().find((mapping) => mapping.relationshipType === 'PRIMARY') || null;
  }

  isActiveReferenceCode(code: string) {
    const normalized = this.normalizeReferenceCode(code);
    return normalized ? this.activeReferenceCodes.has(normalized) : false;
  }

  private loadActiveFramework() {
    this.api.listFrameworks().subscribe({
      next: (frameworks) => {
        this.activeFramework = (frameworks || []).find((framework) => framework.status === 'enabled') || null;
        this.rebuildActiveReferenceCodes();
        this.cdr.markForCheck();
      },
      error: () => {
        this.activeFramework = null;
        this.rebuildActiveReferenceCodes();
        this.cdr.markForCheck();
      },
    });
  }

  private rebuildActiveReferenceCodes() {
    const next = new Set<string>();
    const active = this.activeFramework;
    const mappings = this.control?.frameworkMappings || [];
    if (!active || !mappings.length) {
      this.activeReferenceCodes = next;
      return;
    }

    for (const mapping of mappings) {
      if (!this.isMappingFromActiveFramework(mapping, active)) continue;
      const normalizedCode = this.normalizeReferenceCode(mapping.frameworkCode);
      if (normalizedCode) next.add(normalizedCode);
    }
    this.activeReferenceCodes = next;
  }

  private isMappingFromActiveFramework(
    mapping: ControlFrameworkMappingRecord,
    active: FrameworkSummary,
  ) {
    const activeTokens = [active.framework, active.frameworkId]
      .map((value) => this.normalizeFrameworkToken(value))
      .filter(Boolean);
    if (!activeTokens.length) return false;

    const mappingTokens = [mapping.framework, mapping.frameworkRef?.name, mapping.frameworkRef?.externalId]
      .map((value) => this.normalizeFrameworkToken(value))
      .filter(Boolean);

    if (!mappingTokens.length) return false;
    return mappingTokens.some(
      (token) =>
        activeTokens.includes(token) ||
        activeTokens.some((activeToken) => token.includes(activeToken) || activeToken.includes(token)),
    );
  }

  private normalizeFrameworkToken(value?: string | null) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private normalizeReferenceCode(value?: string | null) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private mapControlForm(control: ControlDefinitionRecord): ControlForm {
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

  private parseList(value: string) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private fetchControlStatus(controlId: string) {
    this.statusLoading = true;
    this.statusError = '';
    this.whyPanelOpen = false;
    this.api.getControlStatus(controlId).subscribe({
      next: (res) => {
        this.controlStatus = res?.status || null;
        this.statusLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.controlStatus = null;
        this.statusError = 'Unable to load control status.';
        this.statusLoading = false;
        this.cdr.markForCheck();
      },
    });
  }
}
