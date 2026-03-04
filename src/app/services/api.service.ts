import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map } from 'rxjs/operators';

export type FrameworkLabel = string;

export type Citation = {
  doc: string;
  page: number;
  kind?: 'CUSTOMER';
};

export type ComplianceSummary = {
  framework: FrameworkLabel | null;
  status: 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN'; // ✅ add UNKNOWN
  missing: string[];
  recommendations: string[];
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

export type AuthLoginResponse = {
  user: AuthUserResponse;
  token: string;
  tokenType?: string;
  expiresIn?: string;
};

export type SettingsNotifications = {
  emailAlerts: boolean;
  inAppAlerts: boolean;
  evidenceAlerts: boolean;
  gapAlerts: boolean;
  digestFrequency: 'INSTANT' | 'DAILY' | 'WEEKLY';
};

export type SettingsAi = {
  responseStyle: 'CONCISE' | 'BALANCED' | 'DETAILED';
  language: 'AUTO' | 'EN' | 'AR';
  toneProfile: 'DEFAULT' | 'EGYPTIAN_CASUAL' | 'ARABIC_FORMAL' | 'ENGLISH_NEUTRAL';
  includeCitations: boolean;
  temperature: number;
};

export type SettingsPermissions = {
  canManageTeam: boolean;
  canEditRoles: boolean;
  canInviteManager: boolean;
  canInviteAdmin: boolean;
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MANAGER' | 'USER';
  createdAt: string;
  updatedAt: string;
};

export type TeamInvite = {
  id: string;
  name: string | null;
  email: string;
  role: 'ADMIN' | 'MANAGER' | 'USER';
  status: 'PENDING' | 'CANCELED';
  invitedByUserId: string;
  invitedByName: string | null;
  invitedByEmail: string | null;
  message: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SettingsMeResponse = {
  ok: boolean;
  user: AuthUserResponse;
  notifications: SettingsNotifications;
  ai: SettingsAi;
  permissions: SettingsPermissions;
};

export type SettingsTeamResponse = {
  ok: boolean;
  members: TeamMember[];
  invites: TeamInvite[];
};

export type ChatApiResponse = {
  conversationId: string;
  assistantMessage: string;

  reply: string;
  citations: Citation[];
  complianceSummary: ComplianceSummary;
  externalLinks?: ExternalLink[];
  messageType?: 'TEXT' | 'AI_STRUCTURED';
  cards?: any[];
  actions?: Array<{
    actionType: 'CREATE_EVIDENCE_REQUEST' | 'LINK_EVIDENCE_CONTROL' | 'CREATE_REMEDIATION_TASK';
    label: string;
    payload?: any;
  }>;
  sources?: Array<{
    objectType: string;
    id: string;
    snippetRef: string | null;
  }>;
  route?: {
    path: string;
    confidence: number;
    confidenceBand?: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  state?: string;
  memory?: Record<string, unknown>;
};

export type ChatConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  user?: AuthUserResponse | null;
};

export type ChatMessageRecord = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  messageType?: 'TEXT' | 'AI_STRUCTURED';
  cards?: any[] | null;
  actions?: Array<{
    actionType: 'CREATE_EVIDENCE_REQUEST' | 'LINK_EVIDENCE_CONTROL' | 'CREATE_REMEDIATION_TASK';
    label: string;
    payload?: any;
  }> | null;
  sources?: Array<{
    objectType: string;
    id: string;
    snippetRef: string | null;
  }> | null;
  createdAt: string;
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
  kind: 'CUSTOMER' | 'STANDARD';
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  docType?: string | null;
  conversation?: { userId?: string | null; title: string; user?: { name: string; email: string } | null };
  _count?: { chunks: number };
  matchControlId?: string | null;
  matchStatus?: string;
  matchNote?: string;
  matchRecommendations?: string[];
  analysisJson?: any;
  analysisVersion?: number;
  analysisComputedAt?: string | null;
  frameworkReferences?: string[];
  reviewedAt?: string | null;
  submittedAt?: string | null;
};

export type UploadListResponse = {
  ok: boolean;
  conversationId?: string;
  activeFramework?: string | null;
  activeFrameworkVersion?: string | null;
  documents: UploadDocumentRecord[];
};

export type UploadDetailResponse = {
  ok: boolean;
  document: UploadDocumentRecord;
  activeFramework?: string | null;
  activeFrameworkVersion?: string | null;
};

export type UploadAnalysisResponse = {
  ok: boolean;
  documentId: string;
  analysis: any | null;
  analysisVersion: number;
  analysisComputedAt: string | null;
};

export type UploadSaveResponse = {
  ok: boolean;
  conversationId: string;
  kind: 'CUSTOMER' | 'STANDARD';
  count: number;
  documents: UploadDocumentRecord[];
  ingestResults?: Array<{
    documentId: string;
    ok: boolean;
    chunks?: number;
    message?: string;
    deduped?: boolean;
  }>;
  dedupedCount?: number;
  dedupedDocuments?: Array<{
    incomingName: string;
    createdDocumentId: string;
    reusedDocumentId: string;
    checksumSha256: string;
  }>;
  customerVectorStoreId?: string | null;
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
  openRisks?: number;
  overdueEvidence?: number;
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

export type ComplianceBreakdown = {
  compliant: number;
  partial: number;
  notCompliant: number;
  unknown: number;
  total: number;
  compliantPct: number;
  partialPct: number;
  notCompliantPct: number;
  unknownPct: number;
};

export type RiskHeatmap = {
  impactLabels: string[];
  likelihoodLabels: string[];
  matrix: number[][];
};

export type RiskHeatmapControl = {
  controlCode: string;
  controlDbId?: string | null;
  title?: string | null;
  status: string;
  impact: string;
  likelihood: string;
  driverId?: string | null;
};

export type RiskDistribution = {
  high: number;
  medium: number;
  low: number;
  total: number;
  exposure: 'high' | 'medium' | 'low';
};

export type RiskDriver = {
  id: string;
  label: string;
  count: number;
};

export type FrameworkProgress = {
  framework: string;
  series: number[];
};

export type UploadSummary = {
  totalUploadedDocuments: number;
  distinctMatchedControls: number;
  documentsPerControl: Array<{
    controlId: string;
    count: number;
  }>;
};

export type DashboardAttentionItem = {
  id: string;
  label: string;
  count: number;
  severity: 'high' | 'medium' | 'low';
  route: string;
  query?: Record<string, string>;
};

export type EvidenceHealthDetail = {
  expiringSoon: number;
  expired: number;
  missing: number;
  reusedAcrossFrameworks: number;
  rejected: number;
  outdated: number;
};

export type EvidenceHealthDetailV2 = {
  expiringIn30: number;
  expired: number;
  missing: number;
  reusedAcrossFrameworks: number;
  rejected: number;
  outdated: number;
};

export type EvidenceHealthVisual = {
  valid: number;
  expiringSoon: number;
  expired: number;
  missing: number;
  total: number;
};

export type AttentionTodayItem = {
  id: string;
  label: string;
  count: number;
  severity: 'high' | 'medium' | 'low';
  kind: 'control' | 'risk' | 'evidence' | 'audit';
  dueInDays?: number | null;
  route: string;
  query?: Record<string, string>;
};

export type DashboardKpi = {
  id: string;
  label: string;
  value: string;
  note?: string;
  severity?: 'high' | 'medium' | 'low';
  trend?: { direction: 'up' | 'down' | 'flat'; delta?: number };
  drilldown?: { route: string; query?: Record<string, string>; label?: string };
};

export type TrendSeriesV2 = {
  id: 'riskScore' | 'compliance' | 'mttr';
  label: string;
  points: number[];
  dates: string[];
  rangeDays: number;
  unit: 'percent' | 'days';
};

export type FrameworkComparisonV2 = {
  framework: string;
  totalControls: number;
  compliant: number;
  partial: number;
  notCompliant: number;
  unknown: number;
  completionPercent: number;
  failedControls: number;
};

export type RecommendedActionV2 = {
  id: string;
  title: string;
  reason: string;
  route: string;
  query?: Record<string, string>;
  severity: 'high' | 'medium' | 'low';
  cta?: string;
};

export type ComplianceGapItem = {
  id: 'missing-evidence' | 'control-not-implemented' | 'control-not-tested' | 'owner-not-assigned' | 'outdated-policy';
  label: string;
  count: number;
  route: string;
  query?: Record<string, string>;
};

export type UpcomingAudit = {
  id: string;
  name: string;
  framework?: string | null;
  date: string;
  daysUntil: number;
  route: string;
  query?: Record<string, string>;
};

export type AuditSummary = {
  upcoming14: number;
  upcoming30: number;
  upcoming90: number;
  upcoming: UpcomingAudit[];
};

export type ExecutiveSummary = {
  headline: string;
  highlights: string[];
  risks: string[];
  lastUpdated: string;
};

export type DashboardFilterOptions = {
  frameworks: string[];
  businessUnits: string[];
  riskCategories: string[];
  timeRanges: number[];
};

export type DashboardTrends = {
  riskScore: number[];
  compliance: number[];
  mttr: number[];
};

export type FrameworkComparison = {
  framework: string;
  completionPercent: number;
  failedControls: number;
};

export type RecommendedAction = {
  id: string;
  title: string;
  reason: string;
  route: string;
  query?: Record<string, string>;
  severity: 'high' | 'medium' | 'low';
};

export type DashboardFilters = {
  framework?: string | null;
  businessUnit?: string | null;
  riskCategory?: string | null;
  rangeDays?: number | null;
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
  metrics: DashboardMetrics;
  appliedFilters?: DashboardFilters;
  filterOptions?: DashboardFilterOptions;
  attentionToday?: AttentionTodayItem[];
  kpis?: DashboardKpi[];
  attentionItems?: DashboardAttentionItem[];
  evidenceHealthDetail?: EvidenceHealthDetail;
  evidenceHealthDetailV2?: EvidenceHealthDetailV2;
  trends?: DashboardTrends;
  trendsV2?: TrendSeriesV2[];
  frameworkComparison?: FrameworkComparison[];
  frameworkComparisonV2?: FrameworkComparisonV2[];
  recommendedActions?: RecommendedAction[];
  recommendedActionsV2?: RecommendedActionV2[];
  auditSummary?: AuditSummary;
  executiveSummary?: ExecutiveSummary;
  complianceGaps?: ComplianceGapItem[];
  complianceBreakdown?: ComplianceBreakdown;
  riskDrivers?: RiskDriver[];
  riskHeatmap?: RiskHeatmap;
  riskDistribution?: RiskDistribution;
  evidenceHealthVisual?: EvidenceHealthVisual;
  frameworkProgress?: FrameworkProgress[];
  months?: string[];
  uploadSummary?: UploadSummary;
  riskHeatmapControls?: RiskHeatmapControl[];
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
  complianceStatus?: 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN';
  sortOrder?: number;
  _count?: { testComponents: number };
  testComponents?: TestComponentRecord[];
  topic?: ControlTopic;
};

export type ControlStatusPayload = {
  controlId: string;
  controlCode: string;
  controlTitle: string;
  complianceStatus: 'PASS' | 'PARTIAL' | 'FAIL' | 'NOT_ASSESSED';
  evidenceCompleteness: {
    accepted: number;
    required: number;
  };
  lastAssessedAt: string | null;
  nextDueAt: string | null;
  owner: string | null;
  openFindingsCount: number;
  weakEvidenceCount?: number;
  weakEvidence?: Array<{
    evidenceId: string;
    title: string;
    score: number;
    grade: 'STRONG' | 'MEDIUM' | 'WEAK';
    reasonCodes: string[];
  }>;
  componentStatuses?: Array<{
    componentId: string;
    requirement: string;
    status: 'PASS' | 'PARTIAL' | 'FAIL';
    bestEvidenceId: string | null;
    bestScore: number | null;
    reasonCodes: string[];
    hasMappedEvidence: boolean;
  }>;
  why?: {
    summary: string;
    failedComponents: Array<{
      componentId: string;
      requirement: string;
      status: 'PASS' | 'PARTIAL' | 'FAIL';
      bestEvidenceId: string | null;
      bestScore: number | null;
      reasonCodes: string[];
      hasMappedEvidence: boolean;
    }>;
    partialComponents: Array<{
      componentId: string;
      requirement: string;
      status: 'PASS' | 'PARTIAL' | 'FAIL';
      bestEvidenceId: string | null;
      bestScore: number | null;
      reasonCodes: string[];
      hasMappedEvidence: boolean;
    }>;
  };
  latestAssessment: {
    status: string;
    confidence: number;
    summary: string | null;
    assessedAt: string;
    assessedById: string | null;
  } | null;
  frequencyDays: number;
};

export type EvidenceQualityFactors = {
  version: number;
  relevance: { points: number; max: number; signals: string[] };
  reliability: { points: number; max: number; signals: string[] };
  freshness: { points: number; max: number; signals: string[] };
  completeness: { points: number; max: number; signals: string[] };
  reasons: Array<{ code: string; msg: string; severity: 'info' | 'warn' | 'blocker' }>;
  fixes: Array<{
    code: string;
    msg: string;
    suggestedAction: 'CREATE_REQUEST' | 'LINK_CONTROL' | 'ADD_METADATA' | 'REUPLOAD';
  }>;
  coverage: {
    linkedControls: string[];
    linkedRequests: string[];
    linkedTestComponents: string[];
  };
};

export type EvidenceQualityPayload = {
  score: number;
  grade: 'STRONG' | 'MEDIUM' | 'WEAK';
  factors: EvidenceQualityFactors;
  computedAt: string;
  version: number;
};

export type EvidenceRecord = {
  id: string;
  title: string;
  type: string;
  source: string;
  documentId?: string | null;
  url?: string | null;
  status: 'SUBMITTED' | 'REVIEWED' | 'ACCEPTED' | 'REJECTED';
  createdById?: string | null;
  createdByName?: string | null;
  reviewedById?: string | null;
  reviewedAt?: string | null;
  reviewComment?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  qualityScore?: number | null;
  qualityGrade?: 'STRONG' | 'MEDIUM' | 'WEAK' | null;
  qualityFactors?: EvidenceQualityFactors | null;
  qualityComputedAt?: string | null;
  qualityVersion?: number;
  createdAt: string;
  updatedAt?: string | null;
  matchControlId?: string | null;
  linksCount?: number;
  links?: Array<{
    id: string;
    controlId: string;
    controlCode?: string | null;
    controlTitle?: string | null;
    linkedById?: string | null;
    createdAt?: string | null;
  }>;
};

export type EvidenceListResponse = {
  items: EvidenceRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type EvidenceRequestRecord = {
  id: string;
  controlId: string;
  controlCode?: string | null;
  controlTitle?: string | null;
  testComponentId?: string | null;
  testComponentRequirement?: string | null;
  ownerId: string;
  ownerName?: string | null;
  dueDate: string;
  status: 'OPEN' | 'SUBMITTED' | 'OVERDUE' | 'CLOSED';
  createdById: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  dedupKey?: string | null;
  fulfillmentCount?: number;
};

export type EvidenceRequestListResponse = {
  items: EvidenceRequestRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type CopilotStructuredResponse = {
  messageType: 'AI_STRUCTURED';
  cards: any[];
  actions: any[];
  sources: Array<{
    objectType: string;
    id: string;
    snippetRef: string | null;
  }>;
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

export type AssignControlResponse = {
  ok: boolean;
  controlId: string;
  framework: string;
  frameworkCode: string;
  topicId?: string | null;
  control?: ControlDefinitionRecord | null;
};

export type AssignTopicResponse = {
  ok: boolean;
  topicId: string;
  topicTitle: string;
  framework: string;
  sourceFramework?: string | null;
  topicMappingCreated: boolean;
  controlsProcessed: number;
  controlsAssigned: number;
  controlsUpdated: number;
  controlsRemoved: number;
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  // ===== Uploads =====

  uploadCustomerFiles(
    conversationId: string,
    files: File[],
    language?: 'ar' | 'en',
  ) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);

    let params = new HttpParams().set('conversationId', conversationId).set('kind', 'CUSTOMER');
    if (language) params = params.set('language', language);

    return this.http.post<UploadSaveResponse>('/api/uploads', fd, { params });
  }

  listUploads(conversationId: string) {
    const params = new HttpParams().set('conversationId', conversationId);
    return this.http.get<UploadListResponse>('/api/uploads', { params });
  }

  listAllUploads() {
    const params = new HttpParams().set('all', 'true');
    return this.http.get<UploadListResponse>('/api/uploads', { params });
  }

  getUpload(id: string) {
    return this.http.get<UploadDetailResponse>(`/api/uploads/${id}`);
  }

  getUploadAnalysis(id: string) {
    return this.http.get<UploadAnalysisResponse>(`/api/uploads/${id}/analysis`);
  }

  deleteUpload(id: string) {
    return this.http.delete<{ ok: boolean }>(`/api/uploads/${id}`);
  }

  updateUploadStatus(id: string, status: 'REVIEWED' | 'SUBMITTED') {
    return this.http.patch<{ ok: boolean; document: UploadDocumentRecord }>(
      `/api/uploads/${id}/status`,
      { status },
    );
  }

  updateUploadMatchStatus(
    id: string,
    matchStatus: 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN',
  ) {
    return this.http.patch<{ ok: boolean; document: UploadDocumentRecord }>(
      `/api/uploads/${id}/match-status`,
      { matchStatus },
    );
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

  getDashboard(filters?: {
    framework?: string;
    businessUnit?: string;
    riskCategory?: string;
    rangeDays?: number;
  }) {
    let params = new HttpParams();
    if (filters?.framework) params = params.set('framework', filters.framework);
    if (filters?.businessUnit) params = params.set('businessUnit', filters.businessUnit);
    if (filters?.riskCategory) params = params.set('riskCategory', filters.riskCategory);
    if (typeof filters?.rangeDays === 'number') params = params.set('rangeDays', filters.rangeDays);
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

  listControlTopics(framework?: string) {
    let params = new HttpParams();
    if (framework) params = params.set('framework', framework);
    return this.http.get<ControlTopic[]>('/api/control-kb/topics', { params });
  }

  listFrameworks() {
    return this.http.get<FrameworkSummary[]>('/api/control-kb/frameworks');
  }

  createFramework(payload: { name: string }) {
    return this.http.post<FrameworkSummary>('/api/control-kb/frameworks', payload);
  }

  updateFramework(id: string, payload: { name?: string; status?: string }) {
    return this.http.patch<FrameworkSummary>(`/api/control-kb/frameworks/${id}`, payload);
  }

  deleteFramework(id: string) {
    return this.http.delete<{ ok: boolean }>(`/api/control-kb/frameworks/${id}`);
  }

  listControlCatalog() {
    return this.http.get<ControlCatalogItem[]>('/api/control-kb/catalog');
  }

  getControlContext(controlCode: string) {
    const params = new HttpParams().set('controlCode', controlCode);
    return this.http.get<ControlContext | null>('/api/control-kb/context', { params });
  }

  createControlTopic(payload: {
    title: string;
    description?: string;
    mode?: string;
    status?: string;
    priority?: number;
    framework?: string;
  }) {
    return this.http.post<ControlTopic>('/api/control-kb/topics', payload);
  }

  updateControlTopic(id: string, payload: Partial<ControlTopic>) {
    return this.http.patch<ControlTopic>(`/api/control-kb/topics/${id}`, payload);
  }

  deleteControlTopic(id: string) {
    return this.http.delete<{ ok: boolean; deleted?: boolean }>(`/api/control-kb/topics/${id}`);
  }

  listControlDefinitions(paramsInput: {
    topicId?: string;
    query?: string;
    status?: string;
    complianceStatus?: string;
    ownerRole?: string;
    evidenceType?: string;
    isoMapping?: string;
    framework?: string;
    frameworkRef?: string;
    gap?: string;
    page?: number;
    pageSize?: number;
  }) {
    let params = new HttpParams();
    if (paramsInput.topicId) params = params.set('topicId', paramsInput.topicId);
    if (paramsInput.query) params = params.set('q', paramsInput.query);
    if (paramsInput.status) params = params.set('status', paramsInput.status);
    if (paramsInput.complianceStatus) params = params.set('compliance', paramsInput.complianceStatus);
    if (paramsInput.ownerRole) params = params.set('ownerRole', paramsInput.ownerRole);
    if (paramsInput.evidenceType) params = params.set('evidenceType', paramsInput.evidenceType);
    if (paramsInput.isoMapping) params = params.set('isoMapping', paramsInput.isoMapping);
    if (paramsInput.framework) params = params.set('framework', paramsInput.framework);
    if (paramsInput.frameworkRef) params = params.set('frameworkRef', paramsInput.frameworkRef);
    if (paramsInput.gap) params = params.set('gap', paramsInput.gap);
    if (paramsInput.page) params = params.set('page', paramsInput.page);
    if (paramsInput.pageSize) params = params.set('pageSize', paramsInput.pageSize);
    return this.http.get<ControlDefinitionListResponse>('/api/control-kb/controls', { params });
  }

  getControlDefinition(id: string) {
    return this.http.get<ControlDefinitionRecord>(`/api/control-kb/controls/${id}`);
  }

  getControlStatus(id: string) {
    return this.http.get<{ ok: boolean; status: ControlStatusPayload }>(
      `/api/control-kb/controls/${id}/status`,
    );
  }

  requestControlEvidence(
    id: string,
    payload: {
      ownerId?: string;
      dueDate?: string;
      cycleKey?: string;
    },
    idempotencyKey: string,
  ) {
    return this.http.post<{ ok: boolean; replayed: boolean; result: any }>(
      `/api/control-kb/controls/${id}/request-evidence`,
      payload || {},
      {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    );
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
    framework?: string;
  }) {
    return this.http.post<ControlDefinitionRecord>('/api/control-kb/controls', payload);
  }

  updateControlDefinition(
    id: string,
    payload: Partial<ControlDefinitionRecord> & { topicId?: string },
  ) {
    return this.http.patch<ControlDefinitionRecord>(`/api/control-kb/controls/${id}`, payload);
  }

  updateControlActivation(id: string, payload: { status: 'enabled' | 'disabled' }) {
    return this.http.patch<ControlDefinitionRecord>(`/api/control-kb/controls/${id}/activation`, payload);
  }

  assignControlToFramework(
    controlId: string,
    payload: {
      framework: string;
      frameworkCode: string;
      topicId?: string | null;
    },
  ) {
    return this.http.post<AssignControlResponse>(`/api/control-kb/controls/${controlId}/assign`, payload);
  }

  assignTopicToFramework(
    topicId: string,
    payload: {
      framework: string;
      sourceFramework?: string | null;
    },
  ) {
    return this.http.post<AssignTopicResponse>(`/api/control-kb/topics/${topicId}/assign`, payload);
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

  // ===== Evidence =====

  listEvidence(params?: {
    status?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }) {
    let query = new HttpParams();
    if (params?.status) query = query.set('status', params.status);
    if (params?.q) query = query.set('q', params.q);
    if (params?.page) query = query.set('page', params.page);
    if (params?.pageSize) query = query.set('pageSize', params.pageSize);
    return this.http.get<EvidenceListResponse>('/api/evidence', { params: query });
  }

  getEvidence(id: string) {
    return this.http.get<{ ok: boolean; evidence: EvidenceRecord }>(`/api/evidence/${id}`);
  }

  getEvidenceByDocumentId(documentId: string) {
    return this.http.get<{ ok: boolean; evidence: EvidenceRecord | null }>(
      `/api/evidence/by-document/${documentId}`,
    );
  }

  getEvidenceQuality(id: string, params?: { controlId?: string; testComponentId?: string }) {
    let query = new HttpParams();
    if (params?.controlId) query = query.set('controlId', params.controlId);
    if (params?.testComponentId) query = query.set('testComponentId', params.testComponentId);
    return this.http.get<{ ok: boolean; quality: EvidenceQualityPayload }>(`/api/evidence/${id}/quality`, {
      params: query,
    });
  }

  recomputeEvidenceQuality(
    id: string,
    payload?: {
      reason?: string;
      force?: boolean;
    },
    idempotencyKey?: string,
    requestId?: string,
  ) {
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (requestId) headers['X-Request-Id'] = requestId;
    return this.http.post<{ ok: boolean; replayed: boolean; quality: EvidenceQualityPayload }>(
      `/api/evidence/${id}/quality/recompute`,
      payload || {},
      { headers },
    );
  }

  getEvidenceReviewInbox(bucket: 'pending' | 'expiring' | 'overdue') {
    const params = new HttpParams().set('bucket', bucket);
    return this.http.get<{ ok: boolean; bucket: string; items: any[] }>('/api/evidence/review/inbox', { params });
  }

  reviewEvidence(
    id: string,
    payload: {
      status: 'SUBMITTED' | 'REVIEWED' | 'ACCEPTED' | 'REJECTED';
      reviewComment?: string;
      validFrom?: string;
      validTo?: string;
      reason?: string;
    },
    requestId?: string,
  ) {
    const headers = requestId ? { 'X-Request-Id': requestId } : undefined;
    return this.http.patch<{ ok: boolean; evidence: EvidenceRecord }>(
      `/api/evidence/${id}/review`,
      payload,
      { headers },
    );
  }

  linkEvidenceToControl(payload: { evidenceId: string; controlId: string; reason?: string }, requestId?: string) {
    const headers = requestId ? { 'X-Request-Id': requestId } : undefined;
    return this.http.post<{ ok: boolean; created: boolean; linkId: string }>(
      '/api/evidence/links',
      payload,
      { headers },
    );
  }

  unlinkEvidenceLink(linkId: string, reason?: string, requestId?: string) {
    const headers = requestId ? { 'X-Request-Id': requestId } : undefined;
    return this.http.request<{ ok: boolean }>('DELETE', `/api/evidence/links/${linkId}`, {
      body: reason ? { reason } : {},
      headers,
    });
  }

  backfillEvidence() {
    return this.http.post<{ ok: boolean; scanned: number; created: number; reused: number }>(
      '/api/evidence/backfill',
      {},
    );
  }

  // ===== Evidence Requests =====

  listEvidenceRequests(params?: {
    status?: string;
    ownerId?: string;
    controlId?: string;
    page?: number;
    pageSize?: number;
  }) {
    let query = new HttpParams();
    if (params?.status) query = query.set('status', params.status);
    if (params?.ownerId) query = query.set('ownerId', params.ownerId);
    if (params?.controlId) query = query.set('controlId', params.controlId);
    if (params?.page) query = query.set('page', params.page);
    if (params?.pageSize) query = query.set('pageSize', params.pageSize);
    return this.http.get<EvidenceRequestListResponse>('/api/evidence-requests', { params: query });
  }

  createEvidenceRequest(payload: {
    controlId: string;
    ownerId: string;
    dueDate: string;
    testComponentId?: string;
    dedupKey?: string;
    reason?: string;
  }, requestId?: string) {
    const headers = requestId ? { 'X-Request-Id': requestId } : undefined;
    return this.http.post<{ ok: boolean; created: boolean; request?: EvidenceRequestRecord; requestId?: string }>(
      '/api/evidence-requests',
      payload,
      { headers },
    );
  }

  fulfillEvidenceRequest(id: string, payload: { evidenceId: string; reason?: string }, requestId?: string) {
    const headers = requestId ? { 'X-Request-Id': requestId } : undefined;
    return this.http.post<{ ok: boolean; fulfillmentId: string; request: EvidenceRequestRecord }>(
      `/api/evidence-requests/${id}/fulfill`,
      payload,
      { headers },
    );
  }

  // ===== Copilot =====

  executeCopilotAction(
    payload: {
      actionType: 'CREATE_EVIDENCE_REQUEST' | 'LINK_EVIDENCE_CONTROL' | 'CREATE_REMEDIATION_TASK';
      payload: any;
      dryRun?: boolean;
    },
    idempotencyKey: string,
    requestId?: string,
  ) {
    const headers: Record<string, string> = {
      'Idempotency-Key': idempotencyKey,
    };
    if (requestId) headers['X-Request-Id'] = requestId;
    return this.http.post<{ ok: boolean; replayed: boolean; action: any }>(
      '/api/copilot/actions/execute',
      payload,
      { headers },
    );
  }

  // ===== Audit Pack =====

  generateAuditPack(payload: { frameworkId?: string; periodStart: string; periodEnd: string }) {
    return this.http.post<{ ok: boolean; pack: any }>(
      '/api/audit-packs/generate',
      payload,
    );
  }

  getAuditPack(id: string) {
    return this.http.get<{ ok: boolean; pack: any }>(`/api/audit-packs/${id}`);
  }

  downloadAuditPack(id: string, format: 'csv' | 'zip') {
    const params = new HttpParams().set('format', format);
    return this.http.get(`/api/audit-packs/${id}/download`, { params, responseType: 'blob' });
  }

  // ===== Connectors =====

  listConnectors() {
    return this.http.get<{ ok: boolean; connectors: any[] }>('/api/connectors');
  }

  createConnector(payload: { name: string; type: string; config?: unknown }) {
    return this.http.post<{ ok: boolean; connector: any }>('/api/connectors', payload);
  }

  runConnector(id: string, payload?: { artifacts?: any[] }) {
    return this.http.post<{ ok: boolean; run: any }>(`/api/connectors/${id}/runs`, payload || {});
  }

  listConnectorArtifacts(id: string) {
    return this.http.get<{ ok: boolean; artifacts: any[] }>(`/api/connectors/${id}/artifacts`);
  }

  convertConnectorArtifactToEvidence(artifactId: string, payload?: { controlId?: string }) {
    return this.http.post<{ ok: boolean; created: boolean; evidenceId: string }>(
      `/api/connectors/artifacts/${artifactId}/convert-to-evidence`,
      payload || {},
    );
  }

  // ===== Chat =====

  chat(
    conversationId: string,
    message: string,
    language?: 'ar' | 'en',
    mentionDocumentIds: string[] = [],
  ) {
    const normalizedMentionIds = Array.isArray(mentionDocumentIds)
      ? mentionDocumentIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    return this.http.post<any>('/api/chat', {
      conversationId,
      message,
      language,
      mentionDocumentIds: normalizedMentionIds,
    });
  }

  evaluateControl(
    conversationId: string,
    control: ControlContext,
    language?: 'ar' | 'en',
  ) {
    return this.http.post<EvaluateControlResponse>('/api/chat/evaluate', {
      conversationId,
      control,
      language,
    });
  }

  // ===== Auth =====

  login(email: string, password: string) {
    return this.http.post<AuthLoginResponse>('/api/auth/login', { email, password });
  }

  me() {
    return this.http.get<{ user: AuthUserResponse }>('/api/auth/me');
  }

  logout() {
    return this.http.post<{ ok: boolean }>('/api/auth/logout', {});
  }

  // ===== Settings =====

  getSettingsMe() {
    return this.http.get<SettingsMeResponse>('/api/settings/me');
  }

  updateSettingsNotifications(payload: Partial<SettingsNotifications>) {
    return this.http.patch<{ ok: boolean; notifications: SettingsNotifications }>(
      '/api/settings/notifications',
      payload,
    );
  }

  updateSettingsAi(payload: Partial<SettingsAi>) {
    return this.http.patch<{ ok: boolean; ai: SettingsAi }>(
      '/api/settings/ai',
      payload,
    );
  }

  listTeamAccess() {
    return this.http.get<SettingsTeamResponse>('/api/settings/team');
  }

  createTeamInvite(payload: {
    email: string;
    name?: string;
    role?: 'ADMIN' | 'MANAGER' | 'USER';
    message?: string;
  }) {
    return this.http.post<{ ok: boolean; invite: TeamInvite }>(
      '/api/settings/team/invite',
      payload,
    );
  }

  cancelTeamInvite(id: string) {
    return this.http.patch<{ ok: boolean }>(
      `/api/settings/team/invites/${id}/cancel`,
      {},
    );
  }

  updateTeamMemberRole(userId: string, role: 'ADMIN' | 'MANAGER' | 'USER') {
    return this.http.patch<{ ok: boolean; member: TeamMember }>(
      `/api/settings/team/${userId}/role`,
      { role },
    );
  }

  // ✅ DELETE conversation in backend
  deleteConversation(conversationId: string) {
    return this.http.delete<{ ok: boolean }>(`/api/chat/${conversationId}`);
  }

  listChatConversations() {
    return this.http.get<ChatConversationSummary[]>('/api/chat/conversations');
  }

  getChatConversation(conversationId: string) {
    return this.http.get<ChatConversationSummary>(`/api/chat/${conversationId}`);
  }

  listChatMessages(conversationId: string) {
    return this.http.get<ChatMessageRecord[]>(`/api/chat/${conversationId}/messages`);
  }

  // ===== Compat wrapper =====
  sendMessage(
    message: string,
    conversationId?: string,
    language?: 'ar' | 'en',
    mentionDocumentIds: string[] = [],
  ) {
    const convId = conversationId || crypto.randomUUID();

    return this.chat(convId, message, language, mentionDocumentIds).pipe(
      map((res) => {
        const reply = String(res?.reply ?? '');
        const backendConversationId = String(res?.conversationId ?? convId);

        const out: ChatApiResponse = {
          conversationId: backendConversationId,
          assistantMessage: reply,
          reply,
          citations: Array.isArray(res?.citations) ? res.citations : [],
          complianceSummary: res?.complianceSummary ?? {
            framework: null,
            status: 'UNKNOWN', // ✅ default UNKNOWN (never PARTIAL)
            missing: [],
            recommendations: [],
          },
          messageType: res?.messageType || 'TEXT',
          cards: Array.isArray(res?.cards) ? res.cards : [],
          actions: Array.isArray(res?.actions) ? res.actions : [],
          sources: Array.isArray(res?.sources) ? res.sources : [],
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
