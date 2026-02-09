import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ApiService,
  ControlDefinitionRecord,
  ControlFrameworkMappingRecord,
  FrameworkSummary,
  TestComponentRecord,
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-control-detail-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './control-detail-page.component.html',
  styleUrl: './control-detail-page.component.css',
})
export class ControlDetailPageComponent implements OnInit {
  control?: ControlDefinitionRecord;
  activeFramework?: FrameworkSummary | null;
  private activeReferenceCodes = new Set<string>();
  loading = true;
  error = '';

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.loadActiveFramework();
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (!id) return;
      this.fetchControl(id);
    });
  }

  get isAdmin() {
    return this.auth.user()?.role === 'ADMIN';
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

  fetchControl(id: string) {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();
    this.api.getControlDefinition(id).subscribe({
      next: (control) => {
        this.control = control || undefined;
        this.rebuildActiveReferenceCodes();
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
}
