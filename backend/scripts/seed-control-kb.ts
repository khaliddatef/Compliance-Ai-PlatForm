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

const filePath = path.resolve(__dirname, '../data/control-kb/iso_control_knowledge_base_seed.xlsx');

const normalizeText = (value: unknown) => String(value ?? '').trim();

const splitScfIds = (value: unknown) =>
  normalizeText(value)
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeIsoCode = (value: string) => value.replace(/^A\./i, '').trim();

const toIsoVariants = (value: string) => {
  const normalized = normalizeIsoCode(value);
  const withPrefix = normalized.startsWith('A.') ? normalized : `A.${normalized}`;
  return Array.from(new Set([value, normalized, withPrefix])).filter(Boolean);
};

const DEFAULT_ACCEPTANCE = 'Evidence clearly meets the requirement.';
const DEFAULT_PARTIAL = 'Evidence partially meets the requirement or is incomplete.';
const DEFAULT_REJECT = 'No relevant evidence or evidence is insufficient.';

async function resetExisting() {
  await prisma.testComponent.deleteMany({
    where: { control: { topic: { standard: STANDARD } } },
  });
  await prisma.controlDefinition.deleteMany({
    where: { topic: { standard: STANDARD } },
  });
  await prisma.controlTopic.deleteMany({
    where: { standard: STANDARD },
  });
}

async function seed() {
  const reset = process.argv.includes('--reset');
  if (reset) {
    console.log('[control-kb] Resetting existing ISO control knowledge base...');
    await resetExisting();
  }

  const workbook = xlsx.readFile(filePath);
  const controlsSheet = workbook.Sheets['Controls (ISO 27001)'];
  const testsSheet = workbook.Sheets['Test Components'];
  const evidenceSheet = workbook.Sheets['Evidence Catalog'];

  if (!controlsSheet || !testsSheet || !evidenceSheet) {
    throw new Error('Missing expected sheets: Controls (ISO 27001), Test Components, Evidence Catalog');
  }

  const controlsRows = xlsx.utils.sheet_to_json<any>(controlsSheet, { defval: '' });
  const testRows = xlsx.utils.sheet_to_json<any>(testsSheet, { defval: '' });
  const evidenceRows = xlsx.utils.sheet_to_json<any>(evidenceSheet, { defval: '' });

  const controlMap = new Map<string, { description: string; isoCodes: Set<string> }>();
  for (const row of controlsRows) {
    const scfId = normalizeText(row.scf_id);
    if (!scfId) continue;

    const description = normalizeText(row.control_description);
    const isoCode = normalizeText(row.iso_control_code);

    const existing = controlMap.get(scfId) || { description: description || scfId, isoCodes: new Set<string>() };
    if (description && !existing.description) {
      existing.description = description;
    }
    if (isoCode) {
      for (const variant of toIsoVariants(isoCode)) {
        existing.isoCodes.add(variant);
      }
    }
    controlMap.set(scfId, existing);
  }

  const testMap = new Map<string, string[]>();
  for (const row of testRows) {
    const scfId = normalizeText(row.scf_id);
    const requirement = normalizeText(row.test_component);
    if (!scfId || !requirement) continue;
    const list = testMap.get(scfId) || [];
    list.push(requirement);
    testMap.set(scfId, list);
  }

  const evidenceMap = new Map<string, Array<{ name: string; description: string }>>();
  for (const row of evidenceRows) {
    const ids = splitScfIds(row.scf_id);
    if (!ids.length) continue;
    const name = normalizeText(row.evidence_name);
    const description = normalizeText(row.evidence_description);
    for (const scfId of ids) {
      const list = evidenceMap.get(scfId) || [];
      if (name) {
        list.push({ name, description });
      }
      evidenceMap.set(scfId, list);
    }
  }

  const topicIdByPrefix = new Map<string, string>();
  const prefixes = new Set(Array.from(controlMap.keys()).map((scfId) => scfId.split('-')[0] || 'General'));

  for (const prefix of prefixes) {
    const title = prefix || 'General';
    let topic = await prisma.controlTopic.findFirst({
      where: { standard: STANDARD, title },
    });

    if (!topic) {
      topic = await prisma.controlTopic.create({
        data: {
          standard: STANDARD,
          title,
          description: `Auto-generated from SCF prefix ${title}.`,
          mode: 'continuous',
          status: 'enabled',
          priority: 0,
        },
      });
    }

    topicIdByPrefix.set(prefix, topic.id);
  }

  let createdControls = 0;
  let createdComponents = 0;

  for (const [scfId, meta] of controlMap.entries()) {
    const prefix = scfId.split('-')[0] || 'General';
    const topicId = topicIdByPrefix.get(prefix);
    if (!topicId) continue;

    const existing = await prisma.controlDefinition.findFirst({
      where: { controlCode: scfId, topicId },
    });

    const isoMappings = Array.from(meta.isoCodes.values());
    const description = meta.description;
    const title = description;

    const control = existing
      ? await prisma.controlDefinition.update({
          where: { id: existing.id },
          data: {
            title,
            description: description || null,
            isoMappings,
          },
        })
      : await prisma.controlDefinition.create({
          data: {
            topicId,
            controlCode: scfId,
            title,
            description: description || null,
            isoMappings,
            status: 'enabled',
          },
        });

    if (!existing) createdControls += 1;

    const requirements = testMap.get(scfId) || [];
    for (let index = 0; index < requirements.length; index += 1) {
      const requirement = requirements[index];
      if (!requirement) continue;

      const existingComponent = await prisma.testComponent.findFirst({
        where: {
          controlId: control.id,
          requirement,
        },
      });
      if (existingComponent) continue;

      const evidence = evidenceMap.get(scfId) || [];
      const evidenceTypes = evidence.map((item) => item.name).filter(Boolean);

      await prisma.testComponent.create({
        data: {
          controlId: control.id,
          requirement,
          evidenceTypes,
          acceptanceCriteria: DEFAULT_ACCEPTANCE,
          partialCriteria: DEFAULT_PARTIAL,
          rejectCriteria: DEFAULT_REJECT,
          sortOrder: index,
        },
      });
      createdComponents += 1;
    }
  }

  console.log(`[control-kb] Seeded ${createdControls} controls and ${createdComponents} test components.`);
}

seed()
  .catch((err) => {
    console.error('[control-kb] Seed failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
