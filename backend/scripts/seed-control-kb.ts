import 'dotenv/config';
import path from 'path';
import xlsx from 'xlsx';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const url = process.env.DATABASE_URL || 'file:./dev.db';
const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url }),
});

const STANDARD = 'ISO';
const filePath = path.resolve(__dirname, '../data/control-kb/tekronyx_GRC_kb_v6_mappings.xlsx');

const normalizeHeader = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

const decodeEntities = (value: string) => {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number.parseInt(num, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
};

const normalizeText = (value: unknown) => decodeEntities(String(value ?? '')).trim();

const splitValues = (value: unknown) =>
  normalizeText(value)
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

const toBoolean = (value: unknown) => {
  const text = normalizeText(value).toLowerCase();
  if (!text) return false;
  return ['true', 'yes', '1', 'y', 'x', 'enabled'].includes(text);
};

const toStatus = (value: unknown) => (toBoolean(value) ? 'enabled' : 'disabled');

const toNumber = (value: unknown) => {
  const numeric = Number.parseFloat(normalizeText(value));
  return Number.isFinite(numeric) ? numeric : undefined;
};

const toInt = (value: unknown) => {
  const numeric = Number.parseInt(normalizeText(value), 10);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const getHeaderMap = (rows: Array<Record<string, unknown>>) => {
  const map = new Map<string, string>();
  const headers = rows.length ? Object.keys(rows[0]) : [];
  for (const header of headers) {
    map.set(normalizeHeader(header), header);
  }
  return map;
};

const getHeader = (map: Map<string, string>, ...candidates: string[]) => {
  for (const candidate of candidates) {
    const header = map.get(normalizeHeader(candidate));
    if (header) return header;
  }
  return undefined;
};

const requireHeader = (map: Map<string, string>, ...candidates: string[]) => {
  const header = getHeader(map, ...candidates);
  if (!header) {
    throw new Error(`Missing column: ${candidates[0]}`);
  }
  return header;
};

const chunk = <T>(items: T[], size = 500) => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const createManyInBatches = async <T>(
  items: T[],
  handler: (chunked: T[]) => Promise<unknown>,
  size = 500,
) => {
  for (const batch of chunk(items, size)) {
    if (!batch.length) continue;
    await handler(batch);
  }
};

const extractGlossaryFromRows = (rows: Array<Record<string, unknown>>) => {
  const glossary = new Map<string, string>();
  const pattern = /\b([A-Za-z][A-Za-z0-9 /\-]{3,})\s*\(([A-Z0-9]{2,10})\)/g;

  for (const row of rows) {
    for (const value of Object.values(row)) {
      const text = normalizeText(value);
      if (!text) continue;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const full = normalizeText(match[1]);
        const abbr = normalizeText(match[2]);
        if (!full || !abbr) continue;
        const existing = glossary.get(abbr);
        if (!existing || full.length > existing.length) {
          glossary.set(abbr, full);
        }
      }
    }
  }

  return glossary;
};

const expandText = (text: string, glossary: Map<string, string>) => {
  if (!text || glossary.size === 0) return text;
  let out = text;
  const entries = Array.from(glossary.entries()).sort((a, b) => b[0].length - a[0].length);

  for (const [abbr, full] of entries) {
    if (!abbr || !full) continue;
    const token = new RegExp(`\\b${abbr.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b(?!\\s*\\))`, 'g');
    out = out.replace(token, `${full} (${abbr})`);
  }

  return out;
};

async function resetExisting() {
  await prisma.controlThreatMapping.deleteMany();
  await prisma.controlRiskMapping.deleteMany();
  await prisma.controlApplicability.deleteMany();
  await prisma.threatCatalog.deleteMany();
  await prisma.riskCatalog.deleteMany();
  await prisma.frameworkSource.deleteMany();
  await prisma.implementationGuidance.deleteMany();
  await prisma.controlRole.deleteMany();
  await prisma.testComponentSignal.deleteMany();
  await prisma.controlRiskContext.deleteMany();
  await prisma.controlEvidenceMapping.deleteMany();
  await prisma.evidenceRequest.deleteMany();
  await prisma.evidenceType.deleteMany();
  await prisma.testComponent.deleteMany();
  await prisma.controlTopicMapping.deleteMany();
  await prisma.controlFrameworkMapping.deleteMany();
  await prisma.controlDefinition.deleteMany();
  await prisma.controlTopic.deleteMany();
  await prisma.framework.deleteMany();
}

async function seed() {
  const reset = process.argv.includes('--reset');
  if (!reset) {
    const existing = await prisma.controlTopic.count();
    if (existing > 0) {
      console.log('[control-kb] Existing control topics found. Skipping seed (use --reset to rebuild).');
      return;
    }
  }
  if (reset) {
    console.log('[control-kb] Resetting existing control knowledge base...');
    await resetExisting();
  }

  const workbook = xlsx.readFile(filePath);
  const readSheet = (name: string) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) throw new Error(`Missing sheet: ${name}`);
    return xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  };

  const frameworkRows = readSheet('01_Frameworks');
  const topicRows = readSheet('02_Topics');
  const controlRows = readSheet('03_Controls');
  const controlTopicRows = readSheet('04_ControlTopicMapping');
  const controlFrameworkRows = readSheet('05_ControlFrameworkMapping');
  const testComponentRows = readSheet('06_TestComponents');
  const evidenceTypeRows = readSheet('07_EvidenceTypes');
  const evidenceRequestRows = readSheet('08_EvidenceRequests');
  const controlEvidenceRows = readSheet('09_ControlEvidenceMapping');
  const controlRiskContextRows = readSheet('10_ControlRiskContext');
  const testComponentSignalRows = readSheet('11_TestComponentSignals');
  const controlRoleRows = readSheet('12_ControlRoles');
  const implGuidanceRows = readSheet('13_ImplGuidance');
  const frameworkSourceRows = readSheet('14_FrameworkSources');
  const riskCatalogRows = readSheet('15_RiskCatalog');
  const threatCatalogRows = readSheet('16_ThreatCatalog');
  const applicabilityRows = readSheet('17_ControlApplicability');
  const controlRiskMappingRows = readSheet('18_ControlRiskMapping');
  const controlThreatMappingRows = readSheet('19_ControlThreatMapping');

  const glossary = extractGlossaryFromRows([
    ...frameworkRows,
    ...topicRows,
    ...controlRows,
    ...testComponentRows,
    ...evidenceTypeRows,
    ...evidenceRequestRows,
    ...controlRiskContextRows,
    ...testComponentSignalRows,
    ...controlRoleRows,
    ...implGuidanceRows,
    ...frameworkSourceRows,
    ...riskCatalogRows,
    ...threatCatalogRows,
  ]);

  const frameworkHeader = getHeaderMap(frameworkRows);
  const frameworkIdHeader = requireHeader(frameworkHeader, 'Framework identifier (FrameworkId)');
  const frameworkNameHeader = requireHeader(frameworkHeader, 'Framework name (full, with abbreviation)');
  const frameworkVersionHeader = getHeader(frameworkHeader, 'Framework version');
  const frameworkEnabledHeader = getHeader(frameworkHeader, 'Enabled (true/false)');
  const frameworkDescriptionHeader = getHeader(frameworkHeader, 'Description (plain language)');

  const frameworkIdSeen = new Set<string>();
  const frameworks = frameworkRows
    .map((row) => {
      const id = normalizeText(row[frameworkIdHeader]);
      const name = expandText(normalizeText(row[frameworkNameHeader]), glossary);
      if (!id || !name || frameworkIdSeen.has(id)) return null;
      frameworkIdSeen.add(id);
      return {
        id,
        externalId: id,
        standard: STANDARD,
        name,
        version: frameworkVersionHeader ? normalizeText(row[frameworkVersionHeader]) || null : null,
        description: frameworkDescriptionHeader
          ? expandText(normalizeText(row[frameworkDescriptionHeader]), glossary) || null
          : null,
        status: frameworkEnabledHeader ? toStatus(row[frameworkEnabledHeader]) : 'enabled',
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    externalId: string;
    standard: string;
    name: string;
    version: string | null;
    description: string | null;
    status: string;
  }>;

  const frameworkIdSet = new Set(frameworks.map((framework) => framework.id));
  const frameworkNameById = new Map(frameworks.map((framework) => [framework.id, framework.name]));

  if (frameworks.length) {
    await prisma.framework.createMany({ data: frameworks });
  }

  const topicHeader = getHeaderMap(topicRows);
  const topicIdHeader = requireHeader(topicHeader, 'Topic identifier (TopicId)');
  const topicNameHeader = requireHeader(topicHeader, 'Topic name (plain language)');
  const topicIntentHeader = getHeader(topicHeader, 'Topic intent (plain language)');
  const topicDesignHeader = getHeader(topicHeader, 'Design principle (plain language)');

  const topicsData: Array<{
    id: string;
    standard: string;
    title: string;
    description: string | null;
    intent: string | null;
    designPrinciple: string | null;
    mode: string;
    status: string;
    priority: number;
  }> = [];

  const topicIdSet = new Set<string>();

  for (const row of topicRows) {
    const id = normalizeText(row[topicIdHeader]);
    const title = expandText(normalizeText(row[topicNameHeader]), glossary);
    if (!id || !title || topicIdSet.has(id)) continue;
    const intent = topicIntentHeader ? expandText(normalizeText(row[topicIntentHeader]), glossary) : '';
    const design = topicDesignHeader ? expandText(normalizeText(row[topicDesignHeader]), glossary) : '';
    topicIdSet.add(id);
    topicsData.push({
      id,
      standard: STANDARD,
      title,
      description: intent || null,
      intent: intent || null,
      designPrinciple: design || null,
      mode: 'continuous',
      status: 'enabled',
      priority: 0,
    });
  }

  const controlHeader = getHeaderMap(controlRows);
  const controlIdHeader = requireHeader(controlHeader, 'Control identifier (ControlId)');
  const controlPrimaryTopicHeader = requireHeader(controlHeader, 'Primary topic identifier (primaryTopicId)');
  const controlTopicNameHeader = getHeader(controlHeader, 'Topic name (plain language)');
  const controlTitleHeader = requireHeader(controlHeader, 'Control title (plain language)');
  const controlDescriptionHeader = getHeader(controlHeader, 'Control description (plain language)');
  const controlQuestionHeader = getHeader(controlHeader, 'Control question (plain language)');
  const controlOwnerHeader = getHeader(controlHeader, 'Owner role (plain language)');
  const controlStatusHeader = getHeader(controlHeader, 'Status (Enabled / Disabled)');
  const controlSortHeader = getHeader(controlHeader, 'Sort order (number)');
  const controlWeightHeader = getHeader(controlHeader, 'Relative control weighting');
  const controlEvidenceListHeader = getHeader(controlHeader, 'Evidence request list numbers (ERL #)');
  const controlScfHeader = getHeader(controlHeader, 'Secure Controls Framework number (SCF #)');

  const controlFrameworkHeader = getHeaderMap(controlFrameworkRows);
  const mappingControlIdHeader = requireHeader(controlFrameworkHeader, 'Control identifier (ControlId)');
  const mappingFrameworkIdHeader = getHeader(controlFrameworkHeader, 'Framework identifier (FrameworkId)');
  const mappingFrameworkNameHeader = requireHeader(
    controlFrameworkHeader,
    'Framework name (full, with abbreviation)',
  );
  const mappingFrameworkCodeHeader = requireHeader(controlFrameworkHeader, 'Control reference code in that framework');
  const mappingRelationshipHeader = getHeader(controlFrameworkHeader, 'Relationship type (PRIMARY / RELATED)');
  const mappingPriorityHeader = getHeader(controlFrameworkHeader, 'Framework priority (number)');

  const isoMap = new Map<string, Set<string>>();
  const controlFrameworkData: Array<{
    controlId: string;
    frameworkId: string | null;
    framework: string;
    frameworkCode: string;
    relationshipType: 'PRIMARY' | 'RELATED';
    priority: number | null;
  }> = [];
  const mappingSeen = new Set<string>();

  for (const row of controlFrameworkRows) {
    const controlId = normalizeText(row[mappingControlIdHeader]);
    const frameworkId = mappingFrameworkIdHeader ? normalizeText(row[mappingFrameworkIdHeader]) : '';
    const frameworkName = expandText(normalizeText(row[mappingFrameworkNameHeader]), glossary);
    const frameworkCode = normalizeText(row[mappingFrameworkCodeHeader]);
    if (!controlId || !frameworkName || !frameworkCode) continue;

    const relationshipRaw = mappingRelationshipHeader ? normalizeText(row[mappingRelationshipHeader]) : '';
    const relationshipType = relationshipRaw.toUpperCase() === 'PRIMARY' ? 'PRIMARY' : 'RELATED';
    const priority = mappingPriorityHeader ? toInt(row[mappingPriorityHeader]) ?? null : null;
    const mapKey = `${controlId}::${frameworkName}::${frameworkCode}::${relationshipType}`;
    if (mappingSeen.has(mapKey)) continue;
    mappingSeen.add(mapKey);

    const frameworkLookup = frameworkId && frameworkIdSet.has(frameworkId) ? frameworkId : null;
    controlFrameworkData.push({
      controlId,
      frameworkId: frameworkLookup,
      framework: frameworkName,
      frameworkCode,
      relationshipType,
      priority,
    });

    if (frameworkName.toLowerCase().includes('iso')) {
      const bucket = isoMap.get(controlId) || new Set<string>();
      bucket.add(frameworkCode);
      isoMap.set(controlId, bucket);
    }
  }

  const controlsData: Array<{
    id: string;
    topicId: string;
    controlCode: string;
    title: string;
    description: string | null;
    question: string | null;
    isoMappings: string[];
    ownerRole: string | null;
    status: string;
    sortOrder: number;
    weight: number | null;
    evidenceRequestList: string[];
  }> = [];
  const controlIdSet = new Set<string>();

  for (let index = 0; index < controlRows.length; index += 1) {
    const row = controlRows[index];
    const controlId = normalizeText(row[controlIdHeader]);
    if (!controlId || controlIdSet.has(controlId)) continue;
    const primaryTopicId = normalizeText(row[controlPrimaryTopicHeader]);
    const topicName = controlTopicNameHeader ? expandText(normalizeText(row[controlTopicNameHeader]), glossary) : '';

    if (primaryTopicId && !topicIdSet.has(primaryTopicId)) {
      topicIdSet.add(primaryTopicId);
      topicsData.push({
        id: primaryTopicId,
        standard: STANDARD,
        title: topicName || primaryTopicId,
        description: topicName || null,
        intent: null,
        designPrinciple: null,
        mode: 'continuous',
        status: 'enabled',
        priority: 0,
      });
    }

    if (!primaryTopicId) continue;

    const title = expandText(normalizeText(row[controlTitleHeader]), glossary) || controlId;
    const description = controlDescriptionHeader
      ? expandText(normalizeText(row[controlDescriptionHeader]), glossary)
      : '';
    const question = controlQuestionHeader ? expandText(normalizeText(row[controlQuestionHeader]), glossary) : '';
    const ownerRole = controlOwnerHeader ? expandText(normalizeText(row[controlOwnerHeader]), glossary) : '';
    const status = controlStatusHeader ? toStatus(row[controlStatusHeader]) : 'enabled';
    const scfNumber = controlScfHeader ? normalizeText(row[controlScfHeader]) : '';
    const sortOrder = toInt(controlSortHeader ? row[controlSortHeader] : '') ?? index + 1;
    const weight = controlWeightHeader ? toNumber(row[controlWeightHeader]) ?? null : null;
    const evidenceRequestList = controlEvidenceListHeader ? splitValues(row[controlEvidenceListHeader]) : [];
    const isoMappings = Array.from(isoMap.get(controlId) || []);

    controlIdSet.add(controlId);
    controlsData.push({
      id: controlId,
      topicId: primaryTopicId,
      controlCode: scfNumber || controlId,
      title,
      description: description || null,
      question: question || null,
      isoMappings,
      ownerRole: ownerRole || null,
      status,
      sortOrder,
      weight,
      evidenceRequestList,
    });
  }

  if (topicsData.length) {
    await prisma.controlTopic.createMany({ data: topicsData });
  }

  if (controlsData.length) {
    await createManyInBatches(
      controlsData,
      (batch) => prisma.controlDefinition.createMany({ data: batch }),
      500,
    );
  }

  const controlTopicHeader = getHeaderMap(controlTopicRows);
  const topicMappingControlId = requireHeader(controlTopicHeader, 'Control identifier (ControlId)');
  const topicMappingTopicId = requireHeader(controlTopicHeader, 'Topic identifier (TopicId)');
  const topicMappingRelationship = getHeader(controlTopicHeader, 'Relationship type (PRIMARY / RELATED)');

  const topicMappingData: Array<{ controlId: string; topicId: string; relationshipType: 'PRIMARY' | 'RELATED' }> = [];
  const topicMappingSeen = new Set<string>();

  for (const row of controlTopicRows) {
    const controlId = normalizeText(row[topicMappingControlId]);
    const topicId = normalizeText(row[topicMappingTopicId]);
    if (!controlId || !topicId || !controlIdSet.has(controlId) || !topicIdSet.has(topicId)) continue;
    const relationshipRaw = topicMappingRelationship ? normalizeText(row[topicMappingRelationship]) : '';
    const relationshipType = relationshipRaw.toUpperCase() === 'PRIMARY' ? 'PRIMARY' : 'RELATED';
    const key = `${controlId}::${topicId}`;
    if (topicMappingSeen.has(key)) continue;
    topicMappingSeen.add(key);
    topicMappingData.push({ controlId, topicId, relationshipType });
  }

  for (const control of controlsData) {
    const key = `${control.id}::${control.topicId}`;
    if (!topicMappingSeen.has(key)) {
      topicMappingSeen.add(key);
      topicMappingData.push({ controlId: control.id, topicId: control.topicId, relationshipType: 'PRIMARY' });
    }
  }

  if (topicMappingData.length) {
    await createManyInBatches(
      topicMappingData,
      (batch) => prisma.controlTopicMapping.createMany({ data: batch }),
      1000,
    );
  }

  const filteredFrameworkMappings = controlFrameworkData.filter((row) => controlIdSet.has(row.controlId));

  if (filteredFrameworkMappings.length) {
    await createManyInBatches(
      filteredFrameworkMappings,
      (batch) => prisma.controlFrameworkMapping.createMany({ data: batch }),
      1000,
    );
  }

  const testHeader = getHeaderMap(testComponentRows);
  const testIdHeader = requireHeader(testHeader, 'Test component identifier (TestComponentId)');
  const testControlIdHeader = requireHeader(testHeader, 'Control identifier (ControlId)');
  const testAoHeader = getHeader(testHeader, 'Assessment objective number (AO #)');
  const testRequirementHeader = requireHeader(testHeader, 'Test component requirement (plain language)');
  const testMethodHeader = getHeader(testHeader, 'Evidence collection method (examine / interview / test)');
  const testProcedureHeader = getHeader(testHeader, 'Assessment procedure (plain language)');
  const testExpectedHeader = getHeader(testHeader, 'Expected result (plain language)');
  const testFrequencyHeader = getHeader(testHeader, 'Assessment frequency (plain language)');
  const testAcceptanceHeader = getHeader(testHeader, 'Acceptance rule (plain language)');
  const testPartialHeader = getHeader(testHeader, 'Partial acceptance rule (plain language)');
  const testRejectHeader = getHeader(testHeader, 'Rejection rule (plain language)');

  const testSortMap = new Map<string, number>();
  const testComponentData: Array<{
    id: string;
    controlId: string;
    assessmentObjective: string | null;
    requirement: string;
    collectionMethod: string | null;
    procedure: string | null;
    expectedResult: string | null;
    frequency: string | null;
    evidenceTypes: string[];
    acceptanceCriteria: string | null;
    partialCriteria: string | null;
    rejectCriteria: string | null;
    sortOrder: number;
  }> = [];
  const testComponentIdSet = new Set<string>();

  for (const row of testComponentRows) {
    const testId = normalizeText(row[testIdHeader]);
    const controlId = normalizeText(row[testControlIdHeader]);
    if (!testId || !controlId || !controlIdSet.has(controlId) || testComponentIdSet.has(testId)) continue;
    const requirement = expandText(normalizeText(row[testRequirementHeader]), glossary);
    if (!requirement) continue;

    const sortOrder = (testSortMap.get(controlId) || 0) + 1;
    testSortMap.set(controlId, sortOrder);

    testComponentIdSet.add(testId);
    testComponentData.push({
      id: testId,
      controlId,
      assessmentObjective: testAoHeader ? normalizeText(row[testAoHeader]) || null : null,
      requirement,
      collectionMethod: testMethodHeader ? normalizeText(row[testMethodHeader]) || null : null,
      procedure: testProcedureHeader ? expandText(normalizeText(row[testProcedureHeader]), glossary) || null : null,
      expectedResult: testExpectedHeader ? expandText(normalizeText(row[testExpectedHeader]), glossary) || null : null,
      frequency: testFrequencyHeader ? normalizeText(row[testFrequencyHeader]) || null : null,
      evidenceTypes: [],
      acceptanceCriteria: testAcceptanceHeader
        ? expandText(normalizeText(row[testAcceptanceHeader]), glossary) || null
        : null,
      partialCriteria: testPartialHeader
        ? expandText(normalizeText(row[testPartialHeader]), glossary) || null
        : null,
      rejectCriteria: testRejectHeader
        ? expandText(normalizeText(row[testRejectHeader]), glossary) || null
        : null,
      sortOrder,
    });
  }

  if (testComponentData.length) {
    await createManyInBatches(
      testComponentData,
      (batch) => prisma.testComponent.createMany({ data: batch }),
      1000,
    );
  }

  const evidenceTypeHeader = getHeaderMap(evidenceTypeRows);
  const evidenceTypeIdHeader = requireHeader(evidenceTypeHeader, 'Evidence type identifier (EvidenceTypeId)');
  const evidenceTypeNameHeader = requireHeader(evidenceTypeHeader, 'Evidence type name (plain language)');

  const evidenceTypes = evidenceTypeRows
    .map((row) => {
      const id = normalizeText(row[evidenceTypeIdHeader]);
      const name = expandText(normalizeText(row[evidenceTypeNameHeader]), glossary);
      if (!id || !name) return null;
      return { id, name };
    })
    .filter(Boolean) as Array<{ id: string; name: string }>;

  if (evidenceTypes.length) {
    await prisma.evidenceType.createMany({ data: evidenceTypes });
  }

  const evidenceRequestHeader = getHeaderMap(evidenceRequestRows);
  const evidenceRowHeader = getHeader(evidenceRequestHeader, 'Row number');
  const evidenceIdHeader = requireHeader(evidenceRequestHeader, 'Evidence request identifier (ERL #)');
  const evidenceAreaHeader = getHeader(evidenceRequestHeader, 'Area of focus (plain language)');
  const evidenceArtifactHeader = getHeader(evidenceRequestHeader, 'Documentation artifact (plain language)');
  const evidenceDescHeader = getHeader(evidenceRequestHeader, 'Artifact description (plain language)');
  const evidenceMappedHeader = getHeader(
    evidenceRequestHeader,
    'Mapped Secure Controls Framework controls (raw)',
  );

  const evidenceRequests = evidenceRequestRows
    .map((row) => {
      const id = normalizeText(row[evidenceIdHeader]);
      if (!id) return null;
      return {
        id,
        rowNumber: evidenceRowHeader ? toInt(row[evidenceRowHeader]) ?? null : null,
        areaFocus: evidenceAreaHeader ? expandText(normalizeText(row[evidenceAreaHeader]), glossary) || null : null,
        artifact: evidenceArtifactHeader
          ? expandText(normalizeText(row[evidenceArtifactHeader]), glossary) || null
          : null,
        description: evidenceDescHeader
          ? expandText(normalizeText(row[evidenceDescHeader]), glossary) || null
          : null,
        mappedControlsRaw: evidenceMappedHeader ? normalizeText(row[evidenceMappedHeader]) || null : null,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    rowNumber: number | null;
    areaFocus: string | null;
    artifact: string | null;
    description: string | null;
    mappedControlsRaw: string | null;
  }>;

  const evidenceRequestIdSet = new Set(evidenceRequests.map((item) => item.id));

  if (evidenceRequests.length) {
    await createManyInBatches(
      evidenceRequests,
      (batch) => prisma.evidenceRequest.createMany({ data: batch }),
      500,
    );
  }

  const controlEvidenceHeader = getHeaderMap(controlEvidenceRows);
  const controlEvidenceIdHeader = requireHeader(controlEvidenceHeader, 'Evidence request identifier (ERL #)');
  const controlEvidenceControlHeader = requireHeader(controlEvidenceHeader, 'Control identifier (ControlId)');

  const controlEvidenceData: Array<{ controlId: string; evidenceRequestId: string }> = [];
  const controlEvidenceSeen = new Set<string>();

  for (const row of controlEvidenceRows) {
    const evidenceId = normalizeText(row[controlEvidenceIdHeader]);
    const controlId = normalizeText(row[controlEvidenceControlHeader]);
    if (!evidenceId || !controlId) continue;
    if (!controlIdSet.has(controlId) || !evidenceRequestIdSet.has(evidenceId)) continue;
    const key = `${controlId}::${evidenceId}`;
    if (controlEvidenceSeen.has(key)) continue;
    controlEvidenceSeen.add(key);
    controlEvidenceData.push({ controlId, evidenceRequestId: evidenceId });
  }

  if (controlEvidenceData.length) {
    await createManyInBatches(
      controlEvidenceData,
      (batch) => prisma.controlEvidenceMapping.createMany({ data: batch }),
      1000,
    );
  }

  const controlRiskHeader = getHeaderMap(controlRiskContextRows);
  const controlRiskIdHeader = requireHeader(controlRiskHeader, 'Control identifier (ControlId)');
  const controlRiskTitleHeader = getHeader(controlRiskHeader, 'Control title (plain language)');
  const controlRiskDescriptionHeader = getHeader(controlRiskHeader, 'Control description (plain language)');
  const controlRiskObjectiveHeader = getHeader(controlRiskHeader, 'Security objective (plain language)');
  const controlRiskImpactHeader = getHeader(
    controlRiskHeader,
    'If this fails, what can happen? (plain language)',
  );
  const controlRiskThemesHeader = getHeader(
    controlRiskHeader,
    'Risk themes (CIA / Regulatory / Financial / Reputation)',
  );
  const controlRiskSeverityHeader = getHeader(controlRiskHeader, 'Severity (Low / Medium / High)');
  const controlRiskNotesHeader = getHeader(controlRiskHeader, 'Notes (plain language)');

  const controlRiskData = controlRiskContextRows
    .map((row) => {
      const controlId = normalizeText(row[controlRiskIdHeader]);
      if (!controlId || !controlIdSet.has(controlId)) return null;
      return {
        controlId,
        controlTitle: controlRiskTitleHeader
          ? expandText(normalizeText(row[controlRiskTitleHeader]), glossary) || null
          : null,
        controlDescription: controlRiskDescriptionHeader
          ? expandText(normalizeText(row[controlRiskDescriptionHeader]), glossary) || null
          : null,
        securityObjective: controlRiskObjectiveHeader
          ? expandText(normalizeText(row[controlRiskObjectiveHeader]), glossary) || null
          : null,
        failureImpact: controlRiskImpactHeader
          ? expandText(normalizeText(row[controlRiskImpactHeader]), glossary) || null
          : null,
        riskThemes: controlRiskThemesHeader ? normalizeText(row[controlRiskThemesHeader]) || null : null,
        severity: controlRiskSeverityHeader ? normalizeText(row[controlRiskSeverityHeader]) || null : null,
        notes: controlRiskNotesHeader ? expandText(normalizeText(row[controlRiskNotesHeader]), glossary) || null : null,
      };
    })
    .filter(Boolean) as Array<{
    controlId: string;
    controlTitle: string | null;
    controlDescription: string | null;
    securityObjective: string | null;
    failureImpact: string | null;
    riskThemes: string | null;
    severity: string | null;
    notes: string | null;
  }>;

  if (controlRiskData.length) {
    await createManyInBatches(
      controlRiskData,
      (batch) => prisma.controlRiskContext.createMany({ data: batch }),
      500,
    );
  }

  const testSignalHeader = getHeaderMap(testComponentSignalRows);
  const signalTestIdHeader = requireHeader(testSignalHeader, 'Test component identifier (TestComponentId)');
  const signalControlIdHeader = requireHeader(testSignalHeader, 'Control identifier (ControlId)');
  const signalRequirementHeader = getHeader(testSignalHeader, 'Test component requirement (plain language)');
  const signalPositiveHeader = getHeader(testSignalHeader, 'Positive signals (increase confidence) (plain language)');
  const signalNegativeHeader = getHeader(testSignalHeader, 'Negative signals (decrease confidence) (plain language)');
  const signalMissingHeader = getHeader(testSignalHeader, 'Missing signals (cause Partial) (plain language)');
  const signalWeightHeader = getHeader(testSignalHeader, 'Signal weight (1-5)');
  const signalOverrideHeader = getHeader(testSignalHeader, 'Context override allowed? (true/false)');
  const signalNotesHeader = getHeader(testSignalHeader, 'Notes (plain language)');

  const signalData = testComponentSignalRows
    .map((row) => {
      const testId = normalizeText(row[signalTestIdHeader]);
      const controlId = normalizeText(row[signalControlIdHeader]);
      if (!testId || !controlId || !testComponentIdSet.has(testId) || !controlIdSet.has(controlId)) return null;
      return {
        testComponentId: testId,
        controlId,
        requirement: signalRequirementHeader
          ? expandText(normalizeText(row[signalRequirementHeader]), glossary) || null
          : null,
        positiveSignals: signalPositiveHeader
          ? expandText(normalizeText(row[signalPositiveHeader]), glossary) || null
          : null,
        negativeSignals: signalNegativeHeader
          ? expandText(normalizeText(row[signalNegativeHeader]), glossary) || null
          : null,
        missingSignals: signalMissingHeader
          ? expandText(normalizeText(row[signalMissingHeader]), glossary) || null
          : null,
        signalWeight: signalWeightHeader ? toInt(row[signalWeightHeader]) ?? null : null,
        contextOverrideAllowed: signalOverrideHeader ? toBoolean(row[signalOverrideHeader]) : null,
        notes: signalNotesHeader ? expandText(normalizeText(row[signalNotesHeader]), glossary) || null : null,
      };
    })
    .filter(Boolean) as Array<{
    testComponentId: string;
    controlId: string;
    requirement: string | null;
    positiveSignals: string | null;
    negativeSignals: string | null;
    missingSignals: string | null;
    signalWeight: number | null;
    contextOverrideAllowed: boolean | null;
    notes: string | null;
  }>;

  if (signalData.length) {
    await createManyInBatches(
      signalData,
      (batch) => prisma.testComponentSignal.createMany({ data: batch }),
      1000,
    );
  }

  const roleHeader = getHeaderMap(controlRoleRows);
  const roleControlIdHeader = requireHeader(roleHeader, 'Control identifier (ControlId)');
  const roleTitleHeader = getHeader(roleHeader, 'Control title (plain language)');
  const roleAccountableHeader = getHeader(roleHeader, 'Accountable role (plain language)');
  const roleResponsibleHeader = getHeader(roleHeader, 'Responsible role (plain language)');
  const roleEvidenceHeader = getHeader(roleHeader, 'Evidence owner role (plain language)');
  const roleNotesHeader = getHeader(roleHeader, 'Notes (plain language)');

  const roleData = controlRoleRows
    .map((row) => {
      const controlId = normalizeText(row[roleControlIdHeader]);
      if (!controlId || !controlIdSet.has(controlId)) return null;
      return {
        controlId,
        controlTitle: roleTitleHeader ? expandText(normalizeText(row[roleTitleHeader]), glossary) || null : null,
        accountableRole: roleAccountableHeader
          ? expandText(normalizeText(row[roleAccountableHeader]), glossary) || null
          : null,
        responsibleRole: roleResponsibleHeader
          ? expandText(normalizeText(row[roleResponsibleHeader]), glossary) || null
          : null,
        evidenceOwnerRole: roleEvidenceHeader
          ? expandText(normalizeText(row[roleEvidenceHeader]), glossary) || null
          : null,
        notes: roleNotesHeader ? expandText(normalizeText(row[roleNotesHeader]), glossary) || null : null,
      };
    })
    .filter(Boolean) as Array<{
    controlId: string;
    controlTitle: string | null;
    accountableRole: string | null;
    responsibleRole: string | null;
    evidenceOwnerRole: string | null;
    notes: string | null;
  }>;

  if (roleData.length) {
    await createManyInBatches(roleData, (batch) => prisma.controlRole.createMany({ data: batch }), 1000);
  }

  const guidanceHeader = getHeaderMap(implGuidanceRows);
  const guidanceControlIdHeader = requireHeader(guidanceHeader, 'Control identifier (ControlId)');
  const guidanceSizeHeader = getHeader(guidanceHeader, 'Company size segment (plain language)');
  const guidanceTextHeader = getHeader(guidanceHeader, 'Suggested implementation approach (plain language)');
  const guidanceSourceHeader = getHeader(guidanceHeader, 'Source');

  const guidanceData = implGuidanceRows
    .map((row) => {
      const controlId = normalizeText(row[guidanceControlIdHeader]);
      if (!controlId || !controlIdSet.has(controlId)) return null;
      return {
        controlId,
        companySizeSegment: guidanceSizeHeader
          ? expandText(normalizeText(row[guidanceSizeHeader]), glossary) || null
          : null,
        guidance: guidanceTextHeader
          ? expandText(normalizeText(row[guidanceTextHeader]), glossary) || null
          : null,
        source: guidanceSourceHeader ? normalizeText(row[guidanceSourceHeader]) || null : null,
      };
    })
    .filter(Boolean) as Array<{
    controlId: string;
    companySizeSegment: string | null;
    guidance: string | null;
    source: string | null;
  }>;

  if (guidanceData.length) {
    await createManyInBatches(
      guidanceData,
      (batch) => prisma.implementationGuidance.createMany({ data: batch }),
      1000,
    );
  }

  const sourceHeader = getHeaderMap(frameworkSourceRows);
  const sourceFrameworkIdHeader = getHeader(sourceHeader, 'Framework identifier (FrameworkId)');
  const sourceFrameworkNameHeader = getHeader(sourceHeader, 'Framework name (full, with abbreviation)');
  const sourceGeographyHeader = getHeader(sourceHeader, 'Geography');
  const sourceSourceHeader = getHeader(sourceHeader, 'Source');
  const sourceAuthoritativeHeader = getHeader(
    sourceHeader,
    'Authoritative Source - Statutory / Regulatory / Contractual / Industry Framework',
  );
  const sourceStrmHeader = getHeader(sourceHeader, 'Set Theory Relationship Mapping (STRM)');
  const sourceUrlHeader = getHeader(sourceHeader, 'URL - Authoritative Source');

  const frameworkSourceData = frameworkSourceRows
    .map((row) => {
      const frameworkId = sourceFrameworkIdHeader ? normalizeText(row[sourceFrameworkIdHeader]) : '';
      const frameworkName = sourceFrameworkNameHeader
        ? expandText(normalizeText(row[sourceFrameworkNameHeader]), glossary)
        : '';
      if (!frameworkId && !frameworkName) return null;
      return {
        frameworkId: frameworkIdSet.has(frameworkId) ? frameworkId : null,
        frameworkName: frameworkName || null,
        geography: sourceGeographyHeader ? normalizeText(row[sourceGeographyHeader]) || null : null,
        source: sourceSourceHeader ? normalizeText(row[sourceSourceHeader]) || null : null,
        authoritativeSource: sourceAuthoritativeHeader
          ? normalizeText(row[sourceAuthoritativeHeader]) || null
          : null,
        strm: sourceStrmHeader ? normalizeText(row[sourceStrmHeader]) || null : null,
        url: sourceUrlHeader ? normalizeText(row[sourceUrlHeader]) || null : null,
      };
    })
    .filter(Boolean) as Array<{
    frameworkId: string | null;
    frameworkName: string | null;
    geography: string | null;
    source: string | null;
    authoritativeSource: string | null;
    strm: string | null;
    url: string | null;
  }>;

  if (frameworkSourceData.length) {
    await createManyInBatches(
      frameworkSourceData,
      (batch) => prisma.frameworkSource.createMany({ data: batch }),
      500,
    );
  }

  const riskHeader = getHeaderMap(riskCatalogRows);
  const riskIdHeader = requireHeader(riskHeader, 'Risk identifier (RiskId)');
  const riskGroupHeader = getHeader(riskHeader, 'Risk grouping (plain language)');
  const riskTitleHeader = getHeader(riskHeader, 'Risk title (plain language)');
  const riskDescHeader = getHeader(riskHeader, 'Risk description (plain language)');
  const riskNistHeader = getHeader(riskHeader, 'NIST Cybersecurity Framework function (plain language)');
  const riskMatPreHeader = getHeader(riskHeader, 'Materiality pre-tax income (reference)');
  const riskMatAssetsHeader = getHeader(riskHeader, 'Materiality total assets (reference)');
  const riskMatEquityHeader = getHeader(riskHeader, 'Materiality total equity (reference)');
  const riskMatRevenueHeader = getHeader(riskHeader, 'Materiality total revenue (reference)');
  const riskSourceHeader = getHeader(riskHeader, 'Source');
  const riskTextHeader = getHeader(riskHeader, '__text');
  const riskTokensHeader = getHeader(riskHeader, '__tokens');

  const riskData = riskCatalogRows
    .map((row) => {
      const id = normalizeText(row[riskIdHeader]);
      if (!id) return null;
      return {
        id,
        grouping: riskGroupHeader ? expandText(normalizeText(row[riskGroupHeader]), glossary) || null : null,
        title: riskTitleHeader ? expandText(normalizeText(row[riskTitleHeader]), glossary) || null : null,
        description: riskDescHeader ? expandText(normalizeText(row[riskDescHeader]), glossary) || null : null,
        nistFunction: riskNistHeader ? normalizeText(row[riskNistHeader]) || null : null,
        materialityPreTaxIncome: riskMatPreHeader ? normalizeText(row[riskMatPreHeader]) || null : null,
        materialityTotalAssets: riskMatAssetsHeader ? normalizeText(row[riskMatAssetsHeader]) || null : null,
        materialityTotalEquity: riskMatEquityHeader ? normalizeText(row[riskMatEquityHeader]) || null : null,
        materialityTotalRevenue: riskMatRevenueHeader ? normalizeText(row[riskMatRevenueHeader]) || null : null,
        source: riskSourceHeader ? normalizeText(row[riskSourceHeader]) || null : null,
        text: riskTextHeader ? normalizeText(row[riskTextHeader]) || null : null,
        tokens: riskTokensHeader ? normalizeText(row[riskTokensHeader]) || undefined : undefined,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    grouping: string | null;
    title: string | null;
    description: string | null;
    nistFunction: string | null;
    materialityPreTaxIncome: string | null;
    materialityTotalAssets: string | null;
    materialityTotalEquity: string | null;
    materialityTotalRevenue: string | null;
    source: string | null;
    text: string | null;
    tokens?: string;
  }>;

  const riskIdSet = new Set(riskData.map((item) => item.id));

  if (riskData.length) {
    await createManyInBatches(riskData, (batch) => prisma.riskCatalog.createMany({ data: batch }), 500);
  }

  const threatHeader = getHeaderMap(threatCatalogRows);
  const threatIdHeader = requireHeader(threatHeader, 'Threat identifier (ThreatId)');
  const threatGroupHeader = getHeader(threatHeader, 'Threat grouping (plain language)');
  const threatTitleHeader = getHeader(threatHeader, 'Threat title (plain language)');
  const threatDescHeader = getHeader(threatHeader, 'Threat description (plain language)');
  const threatMatPreHeader = getHeader(threatHeader, 'Materiality pre-tax income (reference)');
  const threatMatAssetsHeader = getHeader(threatHeader, 'Materiality total assets (reference)');
  const threatMatEquityHeader = getHeader(threatHeader, 'Materiality total equity (reference)');
  const threatMatRevenueHeader = getHeader(threatHeader, 'Materiality total revenue (reference)');
  const threatSourceHeader = getHeader(threatHeader, 'Source');
  const threatTextHeader = getHeader(threatHeader, '__text');
  const threatTokensHeader = getHeader(threatHeader, '__tokens');

  const threatData = threatCatalogRows
    .map((row) => {
      const id = normalizeText(row[threatIdHeader]);
      if (!id) return null;
      return {
        id,
        grouping: threatGroupHeader ? expandText(normalizeText(row[threatGroupHeader]), glossary) || null : null,
        title: threatTitleHeader ? expandText(normalizeText(row[threatTitleHeader]), glossary) || null : null,
        description: threatDescHeader ? expandText(normalizeText(row[threatDescHeader]), glossary) || null : null,
        materialityPreTaxIncome: threatMatPreHeader ? normalizeText(row[threatMatPreHeader]) || null : null,
        materialityTotalAssets: threatMatAssetsHeader ? normalizeText(row[threatMatAssetsHeader]) || null : null,
        materialityTotalEquity: threatMatEquityHeader ? normalizeText(row[threatMatEquityHeader]) || null : null,
        materialityTotalRevenue: threatMatRevenueHeader ? normalizeText(row[threatMatRevenueHeader]) || null : null,
        source: threatSourceHeader ? normalizeText(row[threatSourceHeader]) || null : null,
        text: threatTextHeader ? normalizeText(row[threatTextHeader]) || null : null,
        tokens: threatTokensHeader ? normalizeText(row[threatTokensHeader]) || undefined : undefined,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    grouping: string | null;
    title: string | null;
    description: string | null;
    materialityPreTaxIncome: string | null;
    materialityTotalAssets: string | null;
    materialityTotalEquity: string | null;
    materialityTotalRevenue: string | null;
    source: string | null;
    text: string | null;
    tokens?: string;
  }>;

  const threatIdSet = new Set(threatData.map((item) => item.id));

  if (threatData.length) {
    await createManyInBatches(threatData, (batch) => prisma.threatCatalog.createMany({ data: batch }), 500);
  }

  const applicabilityHeader = getHeaderMap(applicabilityRows);
  const applicabilityControlHeader = requireHeader(applicabilityHeader, 'Control identifier (ControlId)');
  const applicabilityPeopleHeader = getHeader(applicabilityHeader, 'Applies to people (true/false)');
  const applicabilityProcessHeader = getHeader(applicabilityHeader, 'Applies to process (true/false)');
  const applicabilityTechHeader = getHeader(applicabilityHeader, 'Applies to technology (true/false)');
  const applicabilityDataHeader = getHeader(applicabilityHeader, 'Applies to data (true/false)');

  const applicabilityData = applicabilityRows
    .map((row) => {
      const controlId = normalizeText(row[applicabilityControlHeader]);
      if (!controlId || !controlIdSet.has(controlId)) return null;
      return {
        controlId,
        appliesPeople: applicabilityPeopleHeader ? toBoolean(row[applicabilityPeopleHeader]) : null,
        appliesProcess: applicabilityProcessHeader ? toBoolean(row[applicabilityProcessHeader]) : null,
        appliesTechnology: applicabilityTechHeader ? toBoolean(row[applicabilityTechHeader]) : null,
        appliesData: applicabilityDataHeader ? toBoolean(row[applicabilityDataHeader]) : null,
      };
    })
    .filter(Boolean) as Array<{
    controlId: string;
    appliesPeople: boolean | null;
    appliesProcess: boolean | null;
    appliesTechnology: boolean | null;
    appliesData: boolean | null;
  }>;

  if (applicabilityData.length) {
    await createManyInBatches(
      applicabilityData,
      (batch) => prisma.controlApplicability.createMany({ data: batch }),
      1000,
    );
  }

  const controlRiskMapHeader = getHeaderMap(controlRiskMappingRows);
  const controlRiskControlHeader = requireHeader(controlRiskMapHeader, 'Control identifier (ControlId)');
  const controlRiskIdMapHeader = requireHeader(controlRiskMapHeader, 'Risk identifier (RiskId)');
  const controlRiskTitleMapHeader = getHeader(controlRiskMapHeader, 'Risk title (plain language)');
  const controlRiskConfidenceHeader = getHeader(controlRiskMapHeader, 'Mapping confidence (0-1)');
  const controlRiskRelHeader = getHeader(controlRiskMapHeader, 'Relationship type (PRIMARY / RELATED)');
  const controlRiskNotesMapHeader = getHeader(controlRiskMapHeader, 'Notes (plain language)');

  const controlRiskMapData = controlRiskMappingRows
    .map((row) => {
      const controlId = normalizeText(row[controlRiskControlHeader]);
      const riskId = normalizeText(row[controlRiskIdMapHeader]);
      if (!controlId || !riskId || !controlIdSet.has(controlId) || !riskIdSet.has(riskId)) return null;
      const relationshipRaw = controlRiskRelHeader ? normalizeText(row[controlRiskRelHeader]) : '';
      const relationshipType = relationshipRaw.toUpperCase() === 'PRIMARY' ? 'PRIMARY' : 'RELATED';
      return {
        controlId,
        riskId,
        riskTitle: controlRiskTitleMapHeader
          ? expandText(normalizeText(row[controlRiskTitleMapHeader]), glossary) || null
          : null,
        confidence: controlRiskConfidenceHeader ? toNumber(row[controlRiskConfidenceHeader]) ?? null : null,
        relationshipType,
        notes: controlRiskNotesMapHeader ? expandText(normalizeText(row[controlRiskNotesMapHeader]), glossary) || null : null,
      };
    })
    .filter(Boolean) as Array<{
    controlId: string;
    riskId: string;
    riskTitle: string | null;
    confidence: number | null;
    relationshipType: 'PRIMARY' | 'RELATED';
    notes: string | null;
  }>;

  if (controlRiskMapData.length) {
    await createManyInBatches(
      controlRiskMapData,
      (batch) => prisma.controlRiskMapping.createMany({ data: batch }),
      1000,
    );
  }

  const controlThreatHeader = getHeaderMap(controlThreatMappingRows);
  const controlThreatControlHeader = requireHeader(controlThreatHeader, 'Control identifier (ControlId)');
  const controlThreatIdHeader = requireHeader(controlThreatHeader, 'Threat identifier (ThreatId)');
  const controlThreatTitleHeader = getHeader(controlThreatHeader, 'Threat title (plain language)');
  const controlThreatConfidenceHeader = getHeader(controlThreatHeader, 'Mapping confidence (0-1)');
  const controlThreatRelHeader = getHeader(controlThreatHeader, 'Relationship type (PRIMARY / RELATED)');
  const controlThreatNotesHeader = getHeader(controlThreatHeader, 'Notes (plain language)');

  const controlThreatMapData = controlThreatMappingRows
    .map((row) => {
      const controlId = normalizeText(row[controlThreatControlHeader]);
      const threatId = normalizeText(row[controlThreatIdHeader]);
      if (!controlId || !threatId || !controlIdSet.has(controlId) || !threatIdSet.has(threatId)) return null;
      const relationshipRaw = controlThreatRelHeader ? normalizeText(row[controlThreatRelHeader]) : '';
      const relationshipType = relationshipRaw.toUpperCase() === 'PRIMARY' ? 'PRIMARY' : 'RELATED';
      return {
        controlId,
        threatId,
        threatTitle: controlThreatTitleHeader
          ? expandText(normalizeText(row[controlThreatTitleHeader]), glossary) || null
          : null,
        confidence: controlThreatConfidenceHeader ? toNumber(row[controlThreatConfidenceHeader]) ?? null : null,
        relationshipType,
        notes: controlThreatNotesHeader
          ? expandText(normalizeText(row[controlThreatNotesHeader]), glossary) || null
          : null,
      };
    })
    .filter(Boolean) as Array<{
    controlId: string;
    threatId: string;
    threatTitle: string | null;
    confidence: number | null;
    relationshipType: 'PRIMARY' | 'RELATED';
    notes: string | null;
  }>;

  if (controlThreatMapData.length) {
    await createManyInBatches(
      controlThreatMapData,
      (batch) => prisma.controlThreatMapping.createMany({ data: batch }),
      1000,
    );
  }

  console.log(
    `[control-kb] Seeded ${frameworks.length} frameworks, ${topicsData.length} topics, ${controlsData.length} controls, ` +
      `${testComponentData.length} test components.`,
  );
}

seed()
  .catch((err) => {
    console.error('[control-kb] Seed failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
