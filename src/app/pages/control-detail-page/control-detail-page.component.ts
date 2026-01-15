import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ApiService,
  ComplianceStandard,
  ControlDefinitionRecord,
  ControlFrameworkMappingRecord,
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
  standard: ComplianceStandard = 'ISO';
  control?: ControlDefinitionRecord;
  loading = true;
  error = '';

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.route.queryParamMap.subscribe((params) => {
      this.standard = this.normalizeStandard(params.get('standard'));
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

  get frameworkTags() {
    return (this.control?.frameworkMappings || []).map((mapping) => ({
      label: this.getFrameworkLabel(mapping),
      code: mapping.frameworkCode,
    }));
  }

  fetchControl(id: string) {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();
    this.api.getControlDefinition(id).subscribe({
      next: (control) => {
        this.control = control || undefined;
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

  private getFrameworkLabel(mapping: ControlFrameworkMappingRecord) {
    const ref = mapping.frameworkRef;
    return (ref?.externalId || ref?.name || mapping.framework || '').trim() || '—';
  }

  private normalizeStandard(value?: string | null): ComplianceStandard {
    const upper = String(value || 'ISO').toUpperCase();
    if (upper === 'FRA') return 'FRA';
    if (upper === 'CBE') return 'CBE';
    return 'ISO';
  }
}
