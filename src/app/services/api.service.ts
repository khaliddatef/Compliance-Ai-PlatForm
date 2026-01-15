import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map } from 'rxjs/operators';

export type ComplianceStandard = 'ISO' | 'FRA' | 'CBE';

export type Citation = {
  doc: string;
  page: number;
  kind?: 'STANDARD' | 'CUSTOMER';
};

export type ComplianceSummary = {
  standard: ComplianceStandard;
  status: 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN'; // ✅ add UNKNOWN
  missing: { title: string; details?: string }[];
  recommendations: { title: string; details?: string }[];
};

export type ExternalLink = {
  title: string;
  url: string;
};

export type AuthUserResponse = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MANAGER' | 'USER';
};

export type ChatApiResponse = {
  conversationId: string;
  assistantMessage: string;

  reply: string;
  citations: Citation[];
  complianceSummary: ComplianceSummary;
  externalLinks?: ExternalLink[];
};

export type ControlContext = {
  id: string;
  title: string;
  summary: string;
  evidence: string[];
  testComponents: string[];
};

export type ControlCatalogItem = {
  id: string;
  title: string;
  summary?: string | null;
};

export type ControlEvaluation = {
  status: 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN';
  summary: string;
  satisfied: string[];
  missing: string[];
  recommendations: string[];
  citations: Citation[];
};

export type EvaluateControlResponse = {
  ok: boolean;
  conversationId: string;
  controlId: string;
  evaluation: ControlEvaluation;
  evaluationId: string;
};

export type UploadDocumentRecord = {
  id: string;
  conversationId: string;
  standard: string;
  kind: 'CUSTOMER' | 'STANDARD';
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  docType?: string | null;
  conversation?: { title: string };
  _count?: { chunks: number };
  matchControlId?: string | null;
  matchStatus?: string;
  matchNote?: string;
  matchRecommendations?: string[];
  frameworkReferences?: string[];
  reviewedAt?: string | null;
  submittedAt?: string | null;
};

export type UploadListResponse = {
  ok: boolean;
  conversationId?: string;
  documents: UploadDocumentRecord[];
};

export type DashboardMetrics = {
  coveragePercent: number;
  evaluatedControls: number;
  compliant: number;
  partial: number;
  missing: number;
  unknown: number;
  evidenceItems: number;
  awaitingReview: number;
  lastReviewAt: string | null;
  evidenceHealth: {
    high: number;
    medium: number;
    low: number;
    score: number;
    total: number;
  };
  auditReadiness: {
    percent: number;
    acceptedControls: number;
    totalControls: number;
    missingPolicies: number;
    missingLogs: number;
  };
  submissionReadiness: {
    percent: number;
    submitted: number;
    reviewed: number;
  };
};

export type DashboardRiskControl = {
  controlId: string;
  controlDbId?: string | null;
  title?: string | null;
  status: string;
  summary: string;
  updatedAt: string;
};

export type DashboardActivityItem = {
  label: string;
  detail: string;
  time: string;
};

export type DashboardResponse = {
  ok: boolean;
  standard: string;
  metrics: DashboardMetrics;
  riskCoverage: {
    id: string;
    title: string;
    coveragePercent: number;
    controlCount: number;
    missingCount: number;
    controlCodes: string[];
  }[];
  riskControls: DashboardRiskControl[];
  activity: DashboardActivityItem[];
};

export type ControlTopic = {
  id: string;
  standard: string;
  title: string;
  description?: string | null;
  mode?: string;
  status?: string;
  priority?: number;
  controlCount?: number;
};

export type TestComponentRecord = {
  id: string;
  controlId: string;
  requirement: string;
  evidenceTypes?: unknown;
  acceptanceCriteria?: string | null;
  partialCriteria?: string | null;
  rejectCriteria?: string | null;
  sortOrder?: number;
};

export type ControlFrameworkMappingRecord = {
  id: string;
  frameworkId?: string | null;
  framework: string;
  frameworkCode: string;
  frameworkRef?: {
    externalId?: string | null;
    name?: string | null;
  } | null;
};

export type ControlTopicMappingRecord = {
  id: string;
  topicId: string;
  relationshipType: 'PRIMARY' | 'RELATED';
  topic?: ControlTopic;
};

export type ControlDefinitionRecord = {
  id: string;
  topicId: string;
  controlCode: string;
  title: string;
  description?: string | null;
  isoMappings?: string[] | null;
  frameworkMappings?: ControlFrameworkMappingRecord[];
  topicMappings?: ControlTopicMappingRecord[];
  ownerRole?: string | null;
  status?: string;
  sortOrder?: number;
  _count?: { testComponents: number };
  testComponents?: TestComponentRecord[];
  topic?: ControlTopic;
};

export type ControlDefinitionListResponse = {
  items: ControlDefinitionRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type FrameworkSummary = {
  id: string;
  frameworkId?: string;
  framework: string;
  status: 'enabled' | 'disabled';
  controlCount: number;
  topicCount: number;
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  // ===== Uploads =====

  uploadCustomerFiles(
    conversationId: string,
    standard: ComplianceStandard,
    files: File[],
    language?: 'ar' | 'en',
  ) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);

    let params = new HttpParams()
      .set('conversationId', conversationId)
      .set('standard', standard)
      .set('kind', 'CUSTOMER');
    if (language) params = params.set('language', language);

    return this.http.post('/api/uploads', fd, { params });
  }

  uploadStandardFiles(standard: ComplianceStandard, files: File[]) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);

    const params = new HttpParams().set('standard', standard);
    return this.http.post('/api/standards/upload', fd, { params });
  }

  listUploads(conversationId: string) {
    const params = new HttpParams().set('conversationId', conversationId);
    return this.http.get<UploadListResponse>('/api/uploads', { params });
  }

  listAllUploads() {
    const params = new HttpParams().set('all', 'true');
    return this.http.get<UploadListResponse>('/api/uploads', { params });
  }

  deleteUpload(id: string) {
    return this.http.delete<{ ok: boolean }>(`/api/uploads/${id}`);
  }

  downloadUpload(id: string) {
    return this.http.get(`/api/uploads/${id}/download`, { responseType: 'blob' });
  }

  reevaluateUpload(id: string, language?: 'ar' | 'en') {
    let params = new HttpParams();
    if (language) params = params.set('language', language);
    return this.http.post<{ ok: boolean; document: UploadDocumentRecord }>(
      `/api/uploads/${id}/reevaluate`,
      {},
      { params },
    );
  }

  getDashboard(standard: ComplianceStandard) {
    const params = new HttpParams().set('standard', standard);
    return this.http.get<DashboardResponse>('/api/dashboard', { params });
  }

  submitEvidence(documentIds: string[], controlId: string, status: 'COMPLIANT' | 'PARTIAL', note?: string) {
    return this.http.post<{ ok: boolean }>(`/api/uploads/submit`, {
      documentIds,
      controlId,
      status,
      note,
    });
  }

  // ===== Control Knowledge Base =====

  listControlTopics(standard: ComplianceStandard, framework?: string) {
    let params = new HttpParams().set('standard', standard);
    if (framework) params = params.set('framework', framework);
    return this.http.get<ControlTopic[]>('/api/control-kb/topics', { params });
  }

  listFrameworks(standard: ComplianceStandard) {
    const params = new HttpParams().set('standard', standard);
    return this.http.get<FrameworkSummary[]>('/api/control-kb/frameworks', { params });
  }

  createFramework(payload: { standard: ComplianceStandard; name: string }) {
    return this.http.post<FrameworkSummary>('/api/control-kb/frameworks', payload);
  }

  updateFramework(id: string, payload: { name?: string; status?: string }) {
    return this.http.patch<FrameworkSummary>(`/api/control-kb/frameworks/${id}`, payload);
  }

  listControlCatalog(standard: ComplianceStandard) {
    const params = new HttpParams().set('standard', standard);
    return this.http.get<ControlCatalogItem[]>('/api/control-kb/catalog', { params });
  }

  getControlContext(standard: ComplianceStandard, controlCode: string) {
    const params = new HttpParams().set('standard', standard).set('controlCode', controlCode);
    return this.http.get<ControlContext | null>('/api/control-kb/context', { params });
  }

  createControlTopic(payload: {
    standard: ComplianceStandard;
    title: string;
    description?: string;
    mode?: string;
    status?: string;
    priority?: number;
  }) {
    return this.http.post<ControlTopic>('/api/control-kb/topics', payload);
  }

  updateControlTopic(id: string, payload: Partial<ControlTopic>) {
    return this.http.patch<ControlTopic>(`/api/control-kb/topics/${id}`, payload);
  }

  deleteControlTopic(id: string) {
    return this.http.delete<ControlTopic>(`/api/control-kb/topics/${id}`);
  }

  listControlDefinitions(paramsInput: {
    standard: ComplianceStandard;
    topicId?: string;
    query?: string;
    status?: string;
    ownerRole?: string;
    evidenceType?: string;
    isoMapping?: string;
    framework?: string;
    page?: number;
    pageSize?: number;
  }) {
    let params = new HttpParams().set('standard', paramsInput.standard);
    if (paramsInput.topicId) params = params.set('topicId', paramsInput.topicId);
    if (paramsInput.query) params = params.set('q', paramsInput.query);
    if (paramsInput.status) params = params.set('status', paramsInput.status);
    if (paramsInput.ownerRole) params = params.set('ownerRole', paramsInput.ownerRole);
    if (paramsInput.evidenceType) params = params.set('evidenceType', paramsInput.evidenceType);
    if (paramsInput.isoMapping) params = params.set('isoMapping', paramsInput.isoMapping);
    if (paramsInput.framework) params = params.set('framework', paramsInput.framework);
    if (paramsInput.page) params = params.set('page', paramsInput.page);
    if (paramsInput.pageSize) params = params.set('pageSize', paramsInput.pageSize);
    return this.http.get<ControlDefinitionListResponse>('/api/control-kb/controls', { params });
  }

  getControlDefinition(id: string) {
    return this.http.get<ControlDefinitionRecord>(`/api/control-kb/controls/${id}`);
  }

  createControlDefinition(payload: {
    topicId: string;
    controlCode: string;
    title: string;
    description?: string;
    isoMappings?: string[];
    ownerRole?: string;
    status?: string;
    sortOrder?: number;
  }) {
    return this.http.post<ControlDefinitionRecord>('/api/control-kb/controls', payload);
  }

  updateControlDefinition(
    id: string,
    payload: Partial<ControlDefinitionRecord> & { topicId?: string },
  ) {
    return this.http.patch<ControlDefinitionRecord>(`/api/control-kb/controls/${id}`, payload);
  }

  addControlTopicMapping(
    controlId: string,
    topicId: string,
    relationshipType: 'PRIMARY' | 'RELATED' = 'RELATED',
  ) {
    return this.http.post<ControlDefinitionRecord>(`/api/control-kb/controls/${controlId}/topics`, {
      topicId,
      relationshipType,
    });
  }

  removeControlTopicMapping(controlId: string, topicId: string) {
    return this.http.delete<ControlDefinitionRecord>(`/api/control-kb/controls/${controlId}/topics/${topicId}`);
  }

  deleteControlDefinition(id: string) {
    return this.http.delete<ControlDefinitionRecord>(`/api/control-kb/controls/${id}`);
  }

  createTestComponent(controlId: string, payload: {
    requirement: string;
    evidenceTypes?: unknown;
    acceptanceCriteria?: string;
    partialCriteria?: string;
    rejectCriteria?: string;
    sortOrder?: number;
  }) {
    return this.http.post<TestComponentRecord>(`/api/control-kb/controls/${controlId}/test-components`, payload);
  }

  updateTestComponent(id: string, payload: Partial<TestComponentRecord>) {
    return this.http.patch<TestComponentRecord>(`/api/control-kb/test-components/${id}`, payload);
  }

  deleteTestComponent(id: string) {
    return this.http.delete<TestComponentRecord>(`/api/control-kb/test-components/${id}`);
  }

  // ===== Chat =====

  chat(
    conversationId: string,
    standard: ComplianceStandard,
    message: string,
    language?: 'ar' | 'en',
  ) {
    return this.http.post<any>('/api/chat', { conversationId, standard, message, language });
  }

  evaluateControl(
    conversationId: string,
    standard: ComplianceStandard,
    control: ControlContext,
    language?: 'ar' | 'en',
  ) {
    return this.http.post<EvaluateControlResponse>('/api/chat/evaluate', {
      conversationId,
      standard,
      control,
      language,
    });
  }

  // ===== Auth =====

  login(email: string, password: string) {
    return this.http.post<{ user: AuthUserResponse }>('/api/auth/login', { email, password });
  }

  // ✅ DELETE conversation in backend
  deleteConversation(conversationId: string) {
    return this.http.delete<{ ok: boolean }>(`/api/chat/${conversationId}`);
  }

  // ===== Compat wrapper =====
  sendMessage(
    message: string,
    standard: ComplianceStandard,
    conversationId?: string,
    language?: 'ar' | 'en',
  ) {
    const convId = conversationId || 'demo-1';

    return this.chat(convId, standard, message, language).pipe(
      map((res) => {
        const reply = String(res?.reply ?? '');
        const backendConversationId = String(res?.conversationId ?? convId);

        const out: ChatApiResponse = {
          conversationId: backendConversationId,
          assistantMessage: reply,
          reply,
          citations: Array.isArray(res?.citations) ? res.citations : [],
          complianceSummary: res?.complianceSummary ?? {
            standard,
            status: 'UNKNOWN', // ✅ default UNKNOWN (never PARTIAL)
            missing: [],
            recommendations: [],
          },
        };

        // ✅ normalize status defensively
        const st = out.complianceSummary?.status;
        if (!st || !['COMPLIANT', 'PARTIAL', 'NOT_COMPLIANT', 'UNKNOWN'].includes(st)) {
          out.complianceSummary.status = 'UNKNOWN';
        }

        return out;
      }),
    );
  }
}
