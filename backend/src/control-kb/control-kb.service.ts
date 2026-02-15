import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ControlContext } from '../agent/agent.service';

const DEFAULT_ACCEPTANCE = 'Evidence clearly meets the requirement.';
const DEFAULT_PARTIAL = 'Evidence partially meets the requirement or is incomplete.';
const DEFAULT_REJECT = 'No relevant evidence or evidence is insufficient.';

const normalizeIsoCode = (value: string) => value.replace(/^A\./i, '').trim();

const toIsoVariants = (value: string) => {
  const normalized = normalizeIsoCode(value);
  const withPrefix = normalized.startsWith('A.') ? normalized : `A.${normalized}`;
  return Array.from(new Set([value, normalized, withPrefix])).filter(Boolean);
};

type ComplianceGapKey =
  | 'missing-evidence'
  | 'control-not-implemented'
  | 'control-not-tested'
  | 'owner-not-assigned'
  | 'outdated-policy';

const GAP_ALIAS_MAP: Record<string, ComplianceGapKey> = {
  'missing evidence': 'missing-evidence',
  'missing-evidence': 'missing-evidence',
  'control not implemented': 'control-not-implemented',
  'control-not-implemented': 'control-not-implemented',
  'control not tested': 'control-not-tested',
  'control-not-tested': 'control-not-tested',
  'owner not assigned': 'owner-not-assigned',
  'owner-not-assigned': 'owner-not-assigned',
  'outdated policy': 'outdated-policy',
  'outdated-policy': 'outdated-policy',
};

@Injectable()
export class ControlKbService {
  constructor(private readonly prisma: PrismaService) {}

  async listTopics(framework?: string | null, includeDisabled = false) {
    const activeFrameworks = includeDisabled ? null : await this.getActiveFrameworkSet();
    if (activeFrameworks && activeFrameworks.size === 0) {
      return [];
    }

    const frameworkName = String(framework || '').trim() || null;
    const frameworkFilter = frameworkName ? { frameworkMappings: { some: { framework: frameworkName } } } : null;
    const activeFilter = activeFrameworks
      ? { frameworkMappings: { some: { framework: { in: Array.from(activeFrameworks) } } } }
      : null;
    const controlWhere = frameworkFilter && activeFilter
      ? { AND: [frameworkFilter, activeFilter] }
      : frameworkFilter || activeFilter || undefined;

    const grouped = await this.prisma.controlDefinition.groupBy({
      by: ['topicId'],
      where: controlWhere,
      _count: { _all: true },
    });
    const controlCountByTopic = new Map(
      grouped.map((row) => [row.topicId, (row as { _count?: { _all?: number } })._count?._all ?? 0]),
    );
    const relevantTopicIds = new Set(grouped.map((row) => row.topicId));

    const topicFrameworkWhere = frameworkName
      ? { framework: frameworkName }
      : activeFrameworks
        ? { framework: { in: Array.from(activeFrameworks) } }
        : undefined;

    if (topicFrameworkWhere) {
      const topicMappings = await this.prisma.topicFrameworkMapping.findMany({
        where: topicFrameworkWhere,
        select: { topicId: true },
      });
      for (const mapping of topicMappings) {
        relevantTopicIds.add(mapping.topicId);
      }
    }

    const topicsWhere = topicFrameworkWhere
      ? { id: { in: Array.from(relevantTopicIds) } }
      : undefined;

    if (topicFrameworkWhere && !relevantTopicIds.size) {
      return [];
    }

    const topics = await this.prisma.controlTopic.findMany({
      where: topicsWhere,
      orderBy: [{ priority: 'desc' }, { title: 'asc' }],
    });

    return topics.map((topic) => ({
      ...topic,
      controlCount: controlCountByTopic.get(topic.id) || 0,
    }));
  }

  async createTopic(input: {
    title: string;
    description?: string | null;
    mode?: string | null;
    status?: string | null;
    priority?: number | null;
    framework?: string | null;
  }) {
    const framework = String(input.framework || '').trim();
    return this.prisma.$transaction(async (tx) => {
      const topic = await tx.controlTopic.create({
        data: {
          title: input.title,
          description: input.description || null,
          mode: input.mode || 'continuous',
          status: input.status || 'enabled',
          priority: typeof input.priority === 'number' ? input.priority : 0,
        },
      });

      if (framework) {
        const frameworkRef = await tx.framework.findUnique({
          where: { name: framework },
          select: { id: true },
        });
        await tx.topicFrameworkMapping.upsert({
          where: { topicId_framework: { topicId: topic.id, framework } },
          update: {
            frameworkId: frameworkRef?.id || null,
            updatedAt: new Date(),
          },
          create: {
            topicId: topic.id,
            framework,
            frameworkId: frameworkRef?.id || null,
          },
        });
      }

      return topic;
    });
  }

  async updateTopic(
    id: string,
    input: {
      title?: string;
      description?: string | null;
      mode?: string | null;
      status?: string | null;
      priority?: number | null;
    },
  ) {
    return this.prisma.controlTopic.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description ?? undefined,
        mode: input.mode ?? undefined,
        status: input.status ?? undefined,
        priority: typeof input.priority === 'number' ? input.priority : undefined,
      },
    });
  }

  async deleteTopic(id: string) {
    const deleted = await this.prisma.controlTopic.deleteMany({ where: { id } });
    return { ok: true, deleted: deleted.count > 0 };
  }

  async listControls(params: {
    topicId?: string | null;
    query?: string | null;
    status?: string | null;
    complianceStatus?: string | null;
    ownerRole?: string | null;
    evidenceType?: string | null;
    isoMapping?: string | null;
    framework?: string | null;
    frameworkRef?: string | null;
    gap?: string | null;
    page?: number;
    pageSize?: number;
    includeDisabled?: boolean;
  }) {
    const activeFrameworks = params.includeDisabled ? null : await this.getActiveFrameworkSet();
    if (activeFrameworks && activeFrameworks.size === 0) {
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: Math.min(Math.max(params.pageSize || 10, 1), 500),
      };
    }
    const filters: any[] = [];
    if (params.topicId) {
      filters.push({
        OR: [
          { topicId: params.topicId },
          { topicMappings: { some: { topicId: params.topicId } } },
        ],
      });
    }
    const status = params.status?.trim().toLowerCase();
    if (status && status !== 'all') {
      filters.push({ status });
    }
    const ownerRole = params.ownerRole?.trim();
    if (ownerRole) {
      filters.push({ ownerRole: { contains: ownerRole } });
    }
    const framework = params.framework?.trim();
    if (framework) {
      filters.push({ frameworkMappings: { some: { framework } } });
    }
    if (activeFrameworks) {
      filters.push({ frameworkMappings: { some: { framework: { in: Array.from(activeFrameworks) } } } });
    }
    const query = params.query?.trim();
    if (query) {
      filters.push({
        OR: [
          { controlCode: { contains: query } },
          { title: { contains: query } },
        ],
      });
    }

    const where = filters.length > 1 ? { AND: filters } : filters[0];
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(Math.max(params.pageSize || 10, 1), 500);
    const skip = (page - 1) * pageSize;
    const isoMapping = params.isoMapping?.trim();
    const evidenceType = params.evidenceType?.trim();
    const frameworkRef = params.frameworkRef?.trim();
    const gap = this.normalizeGap(params.gap);
    const needsEvidenceFilter = Boolean(evidenceType);
    const needsIsoFilter = Boolean(isoMapping);
    const needsFrameworkRefFilter = Boolean(frameworkRef);
    const needsGapFilter = Boolean(gap);
    const complianceRaw = String(params.complianceStatus || '').trim();
    const needsComplianceFilter = Boolean(complianceRaw) && complianceRaw.toLowerCase() !== 'all';
    const complianceStatus = needsComplianceFilter ? this.normalizeComplianceStatus(complianceRaw) : null;
    const frameworkWhere = activeFrameworks
      ? { framework: { in: Array.from(activeFrameworks) } }
      : framework
        ? { framework }
        : undefined;

    const select = Prisma.validator<Prisma.ControlDefinitionSelect>()({
      id: true,
      topicId: true,
      controlCode: true,
      title: true,
      description: true,
      isoMappings: true,
      topicMappings: {
        select: {
          id: true,
          topicId: true,
          relationshipType: true,
          topic: { select: { id: true, title: true } },
        },
        orderBy: [{ relationshipType: 'asc' }, { createdAt: 'asc' }],
      },
      frameworkMappings: {
        where: frameworkWhere,
        select: {
          id: true,
          frameworkId: true,
          framework: true,
          frameworkCode: true,
          frameworkRef: { select: { externalId: true, name: true, version: true } },
        },
      },
      ownerRole: true,
      status: true,
      sortOrder: true,
      _count: { select: { testComponents: true } },
      topic: { select: { title: true } },
      ...(needsEvidenceFilter ? { testComponents: { select: { evidenceTypes: true } } } : {}),
    });

    if (needsEvidenceFilter || needsIsoFilter || needsFrameworkRefFilter || needsGapFilter || needsComplianceFilter) {
      const items = await this.prisma.controlDefinition.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { controlCode: 'asc' }],
        select,
      });

      let filtered = items;

      if (needsIsoFilter && isoMapping) {
        const variants = toIsoVariants(isoMapping);
        filtered = filtered.filter((control) => {
          const mappings = Array.isArray(control.isoMappings)
            ? (control.isoMappings as unknown[]).map((entry) => String(entry))
            : [];
          const code = String((control as { controlCode?: string }).controlCode || '');
          return mappings.some((value) => variants.includes(value)) || variants.includes(code);
        });
      }

      if (needsEvidenceFilter && evidenceType) {
        const needle = evidenceType.toLowerCase();
        filtered = filtered.filter((control) => {
          const evidence = this.collectEvidence((control as any).testComponents || []);
          return evidence.some((item) => item.toLowerCase().includes(needle));
        });
      }

      if (needsFrameworkRefFilter && frameworkRef) {
        const needle = frameworkRef.toLowerCase();
        filtered = filtered.filter((control) => {
          const references = this.buildFrameworkReferences(control.frameworkMappings || []);
          return references.some((ref) => ref.toLowerCase().includes(needle));
        });
      }

      if (needsGapFilter && gap) {
        filtered = await this.filterControlsByGap(filtered, gap);
      }

      let withCompliance = await this.attachComplianceStatus(
        filtered as Array<{ controlCode: string }>,
      );

      if (needsComplianceFilter && complianceStatus) {
        withCompliance = withCompliance.filter(
          (control) => control.complianceStatus === complianceStatus,
        );
      }

      const total = withCompliance.length;
      const paged = withCompliance.slice(skip, skip + pageSize).map((control) => {
        if ('testComponents' in control) {
          const { testComponents, ...rest } = control as any;
          return rest;
        }
        return control;
      });

      return {
        items: paged,
        total,
        page,
        pageSize,
      };
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.controlDefinition.count({ where }),
      this.prisma.controlDefinition.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { controlCode: 'asc' }],
        skip,
        take: pageSize,
        select,
      }),
    ]);

    const withCompliance = await this.attachComplianceStatus(items as Array<{ controlCode: string }>);

    return {
      items: withCompliance,
      total,
      page,
      pageSize,
    };
  }

  private normalizeGap(value?: string | null): ComplianceGapKey | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    return GAP_ALIAS_MAP[normalized] || null;
  }

  private resolveFrameworkCode(controlCode: string, isoMappings?: string[] | null) {
    const firstIso = Array.isArray(isoMappings)
      ? isoMappings.map((item) => String(item || '').trim()).find(Boolean) || ''
      : '';
    if (firstIso) return normalizeIsoCode(firstIso);
    const code = String(controlCode || '').trim();
    return code || 'custom';
  }

  private resolveDocStatus(docs: Array<{ matchStatus: string | null }>) {
    const statuses = docs
      .map((doc) => String(doc.matchStatus || '').toUpperCase())
      .filter(Boolean);
    if (statuses.includes('COMPLIANT')) return 'COMPLIANT';
    if (statuses.includes('PARTIAL')) return 'PARTIAL';
    if (statuses.includes('NOT_COMPLIANT')) return 'NOT_COMPLIANT';
    return 'UNKNOWN';
  }

  private normalizeComplianceStatus(value?: string | null) {
    const normalized = String(value || '')
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    if (normalized === 'COMPLIANT') return 'COMPLIANT';
    if (normalized === 'PARTIAL') return 'PARTIAL';
    if (normalized === 'NOT_COMPLIANT') return 'NOT_COMPLIANT';
    if (normalized === 'UNKNOWN') return 'UNKNOWN';
    return 'UNKNOWN';
  }

  private async attachComplianceStatus<T extends { controlCode: string }>(items: T[]) {
    if (!items.length) return items as Array<T & { complianceStatus: string }>;

    const controlCodes = items
      .map((item) => String(item.controlCode || '').trim())
      .filter(Boolean);

    if (!controlCodes.length) return items as Array<T & { complianceStatus: string }>;

    const evaluations = await this.prisma.evidenceEvaluation.findMany({
      where: { controlId: { in: controlCodes } },
      orderBy: { createdAt: 'desc' },
      select: { controlId: true, status: true },
    });

    const latestEvalByControl = new Map<string, string>();
    for (const evaluation of evaluations) {
      const code = String(evaluation.controlId || '').trim();
      if (!code || latestEvalByControl.has(code)) continue;
      latestEvalByControl.set(code, this.normalizeComplianceStatus(evaluation.status));
    }

    const missingCodes = controlCodes.filter((code) => !latestEvalByControl.has(code));
    const docsByControl = new Map<string, Array<{ matchStatus: string | null }>>();

    if (missingCodes.length) {
      const documents = await this.prisma.document.findMany({
        where: { matchControlId: { in: missingCodes } },
        select: { matchControlId: true, matchStatus: true },
      });

      for (const doc of documents) {
        const code = String(doc.matchControlId || '').trim();
        if (!code) continue;
        const list = docsByControl.get(code) || [];
        list.push({ matchStatus: doc.matchStatus });
        docsByControl.set(code, list);
      }
    }

    return items.map((item) => {
      const code = String(item.controlCode || '').trim();
      const status =
        latestEvalByControl.get(code) || this.resolveDocStatus(docsByControl.get(code) || []);
      return { ...item, complianceStatus: status };
    });
  }

  private async filterControlsByGap<T extends { id: string; controlCode: string; ownerRole: string | null }>(
    controls: T[],
    gap: ComplianceGapKey,
  ): Promise<T[]> {
    if (!controls.length) return controls;
    const controlCodes = controls.map((control) => control.controlCode);
    const controlIds = controls.map((control) => control.id);

    const evaluations = await this.prisma.evidenceEvaluation.findMany({
      where: { controlId: { in: controlCodes } },
      orderBy: { createdAt: 'desc' },
      select: { controlId: true, status: true, createdAt: true },
    });

    const latestEvalByControl = new Map<string, { status: string }>();
    for (const evaluation of evaluations) {
      if (!latestEvalByControl.has(evaluation.controlId)) {
        latestEvalByControl.set(evaluation.controlId, { status: String(evaluation.status || '').toUpperCase() });
      }
    }

    const documents = await this.prisma.document.findMany({
      where: { matchControlId: { in: controlCodes } },
      select: {
        matchControlId: true,
        matchStatus: true,
        reviewedAt: true,
        submittedAt: true,
        createdAt: true,
        docType: true,
        originalName: true,
      },
    });

    const docsByControl = new Map<string, typeof documents>();
    const latestDocByControl = new Map<string, { createdAt: Date; docType: string | null; originalName: string }>();
    for (const doc of documents) {
      const controlCode = String(doc.matchControlId || '');
      if (!controlCode) continue;
      const list = docsByControl.get(controlCode) || [];
      list.push(doc);
      docsByControl.set(controlCode, list);
      const timestamp = doc.reviewedAt || doc.submittedAt || doc.createdAt;
      const existing = latestDocByControl.get(controlCode);
      if (!existing || timestamp > existing.createdAt) {
        latestDocByControl.set(controlCode, {
          createdAt: timestamp,
          docType: doc.docType || null,
          originalName: doc.originalName || '',
        });
      }
    }

    const evidenceMappings = await this.prisma.controlEvidenceMapping.findMany({
      where: { controlId: { in: controlIds } },
      include: { evidenceRequest: { select: { artifact: true, description: true } } },
    });

    const controlIdToCode = new Map(controls.map((control) => [control.id, control.controlCode]));
    const policyRequiredByControlCode = new Map<string, boolean>();
    for (const mapping of evidenceMappings) {
      const controlCode = controlIdToCode.get(mapping.controlId);
      if (!controlCode) continue;
      const text = `${mapping.evidenceRequest?.artifact || ''} ${mapping.evidenceRequest?.description || ''}`
        .toLowerCase();
      if (text.includes('policy')) {
        policyRequiredByControlCode.set(controlCode, true);
      }
    }

    const now = Date.now();

    return controls.filter((control) => {
      const code = control.controlCode;
      const evaluation = latestEvalByControl.get(code);
      const docs = docsByControl.get(code) || [];
      const status = evaluation?.status || this.resolveDocStatus(docs);
      if (status !== 'NOT_COMPLIANT' && status !== 'PARTIAL') return false;

      const ownerRole = String(control.ownerRole || '').trim();
      const latestDoc = latestDocByControl.get(code);
      const policyRequired = policyRequiredByControlCode.get(code) || false;
      const policyDocName = `${latestDoc?.docType || ''} ${latestDoc?.originalName || ''}`.toLowerCase();
      const isPolicyDoc = policyDocName.includes('policy');
      const ageDays = latestDoc
        ? Math.floor((now - latestDoc.createdAt.getTime()) / 86400000)
        : null;

      let gapKey: ComplianceGapKey;
      if (!docs.length) gapKey = 'missing-evidence';
      else if (!ownerRole) gapKey = 'owner-not-assigned';
      else if ((policyRequired || isPolicyDoc) && ageDays !== null && ageDays >= 180) {
        gapKey = 'outdated-policy';
      } else if (!evaluation) {
        gapKey = 'control-not-tested';
      } else {
        gapKey = 'control-not-implemented';
      }

      return gapKey === gap;
    });
  }

  async listFrameworks(includeDisabled = true) {
    const frameworks = await this.prisma.framework.findMany();

    const mappings = await this.prisma.controlFrameworkMapping.findMany({
      select: {
        framework: true,
        controlId: true,
        control: { select: { topicId: true } },
      },
    });
    const topicMappings = await this.prisma.topicFrameworkMapping.findMany({
      select: {
        framework: true,
        topicId: true,
      },
    });

    const known = new Set(frameworks.map((item) => item.name));
    const mappedFrameworkNames = new Set([
      ...mappings.map((item) => item.framework),
      ...topicMappings.map((item) => item.framework),
    ]);
    const missing = Array.from(mappedFrameworkNames).filter((name) => name && !known.has(name));
    if (missing.length) {
      await this.prisma.framework.createMany({
        data: missing.map((name) => ({ name, status: 'disabled' })),
      });
    }

    const refreshed = missing.length ? await this.prisma.framework.findMany() : frameworks;
    const visible = includeDisabled ? refreshed : refreshed.filter((item) => item.status === 'enabled');

    const summary = new Map<string, { controlIds: Set<string>; topicIds: Set<string> }>();
    for (const mapping of mappings) {
      const label = String(mapping.framework || '').trim();
      if (!label) continue;
      let entry = summary.get(label);
      if (!entry) {
        entry = { controlIds: new Set(), topicIds: new Set() };
        summary.set(label, entry);
      }
      entry.controlIds.add(mapping.controlId);
      if (mapping.control?.topicId) {
        entry.topicIds.add(mapping.control.topicId);
      }
    }
    for (const mapping of topicMappings) {
      const label = String(mapping.framework || '').trim();
      if (!label) continue;
      let entry = summary.get(label);
      if (!entry) {
        entry = { controlIds: new Set(), topicIds: new Set() };
        summary.set(label, entry);
      }
      entry.topicIds.add(mapping.topicId);
    }

    return visible
      .map((framework) => {
        const stats = summary.get(framework.name);
        const frameworkId = framework.externalId || framework.name;
        return {
          id: framework.id,
          frameworkId,
          framework: framework.name,
          status: framework.status,
          controlCount: stats?.controlIds.size || 0,
          topicCount: stats?.topicIds.size || 0,
        };
      })
      .sort((a, b) => {
        const aActive = a.status === 'enabled';
        const bActive = b.status === 'enabled';
        if (aActive !== bActive) return aActive ? -1 : 1;
        return (a.frameworkId || a.framework).localeCompare(b.frameworkId || b.framework);
      });
  }

  async updateFramework(
    id: string,
    input: {
      name?: string;
      status?: string;
    },
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.framework.findUnique({ where: { id } });
      if (!existing) {
        throw new Error('Framework not found');
      }
      const nextName = String(input.name || '').trim() || null;
      if (nextName && nextName !== existing.name) {
        const duplicate = await tx.framework.findUnique({ where: { name: nextName } });
        if (duplicate && duplicate.id !== id) {
          throw new BadRequestException('Framework name already exists');
        }
      }
      const nextStatus = input.status ?? existing.status;
      if (nextStatus === 'enabled') {
        await tx.framework.updateMany({
          where: { id: { not: id }, status: 'enabled' },
          data: { status: 'disabled', updatedAt: new Date() },
        });
      }
      if (nextName && nextName !== existing.name) {
        await tx.controlFrameworkMapping.updateMany({
          where: {
            OR: [{ frameworkId: id }, { framework: existing.name }],
          },
          data: { framework: nextName, updatedAt: new Date() },
        });
        await tx.frameworkSource.updateMany({
          where: {
            OR: [{ frameworkId: id }, { frameworkName: existing.name }],
          },
          data: { frameworkName: nextName, updatedAt: new Date() },
        });
        await tx.topicFrameworkMapping.updateMany({
          where: {
            OR: [{ frameworkId: id }, { framework: existing.name }],
          },
          data: { framework: nextName, frameworkId: id, updatedAt: new Date() },
        });
      }
      return tx.framework.update({
        where: { id },
        data: {
          name: nextName ?? undefined,
          status: input.status ?? undefined,
        },
      });
    });
    const counts = await this.getFrameworkCounts(updated.name);
    return {
      id: updated.id,
      frameworkId: updated.externalId || updated.name,
      framework: updated.name,
      status: updated.status,
      controlCount: counts.controlCount,
      topicCount: counts.topicCount,
    };
  }

  async deleteFramework(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.framework.findUnique({ where: { id } });
      if (!existing) {
        throw new BadRequestException('Framework not found');
      }

      await tx.controlFrameworkMapping.deleteMany({
        where: {
          OR: [{ frameworkId: id }, { framework: existing.name }],
        },
      });

      await tx.frameworkSource.deleteMany({
        where: {
          OR: [{ frameworkId: id }, { frameworkName: existing.name }],
        },
      });
      await tx.topicFrameworkMapping.deleteMany({
        where: {
          OR: [{ frameworkId: id }, { framework: existing.name }],
        },
      });

      await tx.framework.delete({ where: { id } });
    });
  }

  async createFramework(input: { name: string; status?: string }) {
    const name = input.name.trim();

    const existing = await this.prisma.framework.findUnique({
      where: { name },
    });
    if (existing) {
      const counts = await this.getFrameworkCounts(existing.name);
      return {
        id: existing.id,
        frameworkId: existing.externalId || existing.name,
        framework: existing.name,
        status: existing.status,
        controlCount: counts.controlCount,
        topicCount: counts.topicCount,
      };
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const status = input.status || 'enabled';
      const created = await tx.framework.create({
        data: {
          name,
          status,
        },
      });
      if (status === 'enabled') {
        await tx.framework.updateMany({
          where: { id: { not: created.id }, status: 'enabled' },
          data: { status: 'disabled', updatedAt: new Date() },
        });
      }
      return created;
    });
    const counts = await this.getFrameworkCounts(created.name);
    return {
      id: created.id,
      frameworkId: created.externalId || created.name,
      framework: created.name,
      status: created.status,
      controlCount: counts.controlCount,
      topicCount: counts.topicCount,
    };
  }

  private async getFrameworkCounts(framework: string) {
    const [mappings, topicMappings] = await this.prisma.$transaction([
      this.prisma.controlFrameworkMapping.findMany({
        where: {
          framework,
        },
        select: {
          controlId: true,
          control: { select: { topicId: true } },
        },
      }),
      this.prisma.topicFrameworkMapping.findMany({
        where: { framework },
        select: { topicId: true },
      }),
    ]);

    const controlIds = new Set<string>();
    const topicIds = new Set<string>();
    for (const mapping of mappings) {
      controlIds.add(mapping.controlId);
      if (mapping.control?.topicId) {
        topicIds.add(mapping.control.topicId);
      }
    }
    for (const mapping of topicMappings) {
      topicIds.add(mapping.topicId);
    }
    return { controlCount: controlIds.size, topicCount: topicIds.size };
  }

  private async getActiveFrameworkSet() {
    const frameworks = await this.prisma.framework.findMany({
      select: { name: true, status: true },
    });
    if (!frameworks.length) return null;
    const enabled = frameworks.filter((item) => item.status === 'enabled').map((item) => item.name);
    return new Set(enabled);
  }

  async getActiveFrameworkLabel() {
    const active = await this.prisma.framework.findFirst({
      where: { status: 'enabled' },
      orderBy: { updatedAt: 'desc' },
      select: { name: true },
    });
    return active?.name || null;
  }

  async listControlCatalog() {
    const baseWhere = { status: 'enabled' };
    const where = baseWhere;

    const controls = await this.prisma.controlDefinition.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { controlCode: 'asc' }],
      select: {
        controlCode: true,
        title: true,
        description: true,
      },
    });

    return controls.map((control) => ({
      id: control.controlCode,
      title: control.title,
      summary: control.description || '',
    }));
  }

  async getControl(id: string, includeMappings = false) {
    const control = await this.prisma.controlDefinition.findUnique({
      where: { id },
      include: {
        testComponents: { orderBy: { sortOrder: 'asc' } },
        topic: true,
        topicMappings: {
          select: {
            id: true,
            topicId: true,
            relationshipType: true,
            topic: { select: { id: true, title: true } },
          },
          orderBy: [{ relationshipType: 'asc' }, { createdAt: 'asc' }],
        },
        frameworkMappings: includeMappings
          ? {
              orderBy: [{ framework: 'asc' }, { frameworkCode: 'asc' }],
              include: {
                frameworkRef: { select: { externalId: true, name: true, version: true } },
              },
            }
          : false,
      },
    });

    if (!control) return null;
    const hasPrimary = control.topicMappings?.some(
      (mapping) => mapping.relationshipType === 'PRIMARY' && mapping.topicId === control.topicId,
    );
    if (!hasPrimary) {
      await this.prisma.controlTopicMapping.upsert({
        where: { controlId_topicId: { controlId: control.id, topicId: control.topicId } },
        update: { relationshipType: 'PRIMARY' },
        create: {
          controlId: control.id,
          topicId: control.topicId,
          relationshipType: 'PRIMARY',
        },
      });
      return this.getControl(control.id, includeMappings);
    }

    return control;
  }

  async createControl(input: {
    topicId: string;
    controlCode: string;
    title: string;
    description?: string | null;
    isoMappings?: string[] | null;
    ownerRole?: string | null;
    status?: string | null;
    sortOrder?: number | null;
    framework?: string | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const control = await tx.controlDefinition.create({
        data: {
          topicId: input.topicId,
          controlCode: input.controlCode,
          title: input.title,
          description: input.description || null,
          isoMappings: input.isoMappings ?? undefined,
          ownerRole: input.ownerRole || null,
          status: input.status || 'enabled',
          sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : 0,
        },
      });

      await tx.controlTopicMapping.create({
        data: {
          controlId: control.id,
          topicId: control.topicId,
          relationshipType: 'PRIMARY',
        },
      });

      const frameworkNames = new Set<string>();
      const explicitFramework = String(input.framework || '').trim();
      if (explicitFramework) {
        frameworkNames.add(explicitFramework);
      } else {
        const topicMappings = await tx.topicFrameworkMapping.findMany({
          where: { topicId: control.topicId },
          select: { framework: true },
        });
        for (const mapping of topicMappings) {
          const framework = String(mapping.framework || '').trim();
          if (framework) frameworkNames.add(framework);
        }
      }

      if (frameworkNames.size) {
        const names = Array.from(frameworkNames);
        const frameworkRefs = await tx.framework.findMany({
          where: { name: { in: names } },
          select: { id: true, name: true },
        });
        const frameworkIdByName = new Map(frameworkRefs.map((item) => [item.name, item.id]));
        const frameworkCode = this.resolveFrameworkCode(input.controlCode, input.isoMappings);
        for (const framework of names) {
          await tx.controlFrameworkMapping.create({
            data: {
              controlId: control.id,
              framework,
              frameworkId: frameworkIdByName.get(framework) || null,
              frameworkCode,
              relationshipType: 'PRIMARY',
            },
          });
        }
      }

      return control;
    });
  }

  async updateControl(
    id: string,
    input: {
      topicId?: string;
      controlCode?: string;
      title?: string;
      description?: string | null;
      isoMappings?: string[] | null;
      ownerRole?: string | null;
      status?: string | null;
      sortOrder?: number | null;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const control = await tx.controlDefinition.update({
        where: { id },
        data: {
          topicId: input.topicId ?? undefined,
          controlCode: input.controlCode,
          title: input.title,
          description: input.description ?? undefined,
          isoMappings: input.isoMappings ?? undefined,
          ownerRole: input.ownerRole ?? undefined,
          status: input.status ?? undefined,
          sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : undefined,
        },
      });

      if (input.topicId) {
        await tx.controlTopicMapping.updateMany({
          where: { controlId: id, relationshipType: 'PRIMARY' },
          data: { relationshipType: 'RELATED' },
        });

        await tx.controlTopicMapping.upsert({
          where: { controlId_topicId: { controlId: id, topicId: input.topicId } },
          update: { relationshipType: 'PRIMARY' },
          create: {
            controlId: id,
            topicId: input.topicId,
            relationshipType: 'PRIMARY',
          },
        });
      }

      return control;
    });
  }

  async updateControlActivation(id: string, status: 'enabled' | 'disabled') {
    return this.prisma.controlDefinition.update({
      where: { id },
      data: { status },
    });
  }

  async addControlTopicMapping(controlId: string, topicId: string, relationshipType: 'PRIMARY' | 'RELATED') {
    const control = await this.prisma.controlDefinition.findUnique({
      where: { id: controlId },
      select: { id: true, topicId: true },
    });
    if (!control) throw new BadRequestException('Control not found');

    const topic = await this.prisma.controlTopic.findUnique({
      where: { id: topicId },
      select: { id: true },
    });
    if (!topic) throw new BadRequestException('Topic not found');

    if (relationshipType === 'PRIMARY') {
      return this.prisma.$transaction(async (tx) => {
        await tx.controlDefinition.update({
          where: { id: controlId },
          data: { topicId },
        });
        await tx.controlTopicMapping.updateMany({
          where: { controlId, relationshipType: 'PRIMARY' },
          data: { relationshipType: 'RELATED' },
        });
        await tx.controlTopicMapping.upsert({
          where: { controlId_topicId: { controlId, topicId } },
          update: { relationshipType: 'PRIMARY' },
          create: { controlId, topicId, relationshipType: 'PRIMARY' },
        });
        return this.getControl(controlId, true);
      });
    }

    await this.prisma.controlTopicMapping.upsert({
      where: { controlId_topicId: { controlId, topicId } },
      update: {},
      create: {
        controlId,
        topicId,
        relationshipType: 'RELATED',
      },
    });

    return this.getControl(controlId, true);
  }

  async removeControlTopicMapping(controlId: string, topicId: string) {
    const mapping = await this.prisma.controlTopicMapping.findUnique({
      where: { controlId_topicId: { controlId, topicId } },
      select: { id: true, relationshipType: true },
    });
    if (!mapping) return this.getControl(controlId, true);
    if (mapping.relationshipType === 'PRIMARY') {
      throw new BadRequestException('Cannot remove primary topic mapping');
    }

    await this.prisma.controlTopicMapping.delete({ where: { id: mapping.id } });
    return this.getControl(controlId, true);
  }

  async deleteControl(id: string) {
    return this.prisma.controlDefinition.delete({ where: { id } });
  }

  async createTestComponent(
    controlId: string,
    input: {
      requirement: string;
      evidenceTypes?: unknown;
      acceptanceCriteria?: string | null;
      partialCriteria?: string | null;
      rejectCriteria?: string | null;
      sortOrder?: number | null;
    },
  ) {
    return this.prisma.testComponent.create({
      data: {
        controlId,
        requirement: input.requirement,
        evidenceTypes: input.evidenceTypes ?? undefined,
        acceptanceCriteria: input.acceptanceCriteria || DEFAULT_ACCEPTANCE,
        partialCriteria: input.partialCriteria || DEFAULT_PARTIAL,
        rejectCriteria: input.rejectCriteria || DEFAULT_REJECT,
        sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : 0,
      },
    });
  }

  async updateTestComponent(
    id: string,
    input: {
      requirement?: string;
      evidenceTypes?: unknown;
      acceptanceCriteria?: string | null;
      partialCriteria?: string | null;
      rejectCriteria?: string | null;
      sortOrder?: number | null;
    },
  ) {
    return this.prisma.testComponent.update({
      where: { id },
      data: {
        requirement: input.requirement,
        evidenceTypes: input.evidenceTypes ?? undefined,
        acceptanceCriteria: input.acceptanceCriteria ?? undefined,
        partialCriteria: input.partialCriteria ?? undefined,
        rejectCriteria: input.rejectCriteria ?? undefined,
        sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : undefined,
      },
    });
  }

  async deleteTestComponent(id: string) {
    return this.prisma.testComponent.delete({ where: { id } });
  }

  async getControlContextByCode(params: {
    controlCode: string;
    includeDisabled?: boolean;
  }): Promise<ControlContext | null> {
    const controlCode = params.controlCode?.trim();
    if (!controlCode) return null;

    const includeDisabled = params.includeDisabled === true;
    const direct = await this.prisma.controlDefinition.findFirst({
      where: {
        controlCode,
      },
      include: { testComponents: true, frameworkMappings: { select: { framework: true } } },
    });

    const control = direct || (await this.findByIsoMapping(controlCode));
    if (!control) return null;
    if (!includeDisabled && String(control.status || '').toLowerCase() !== 'enabled') {
      return null;
    }

    const evidence = this.collectEvidence(control.testComponents || []);

    return {
      id: control.controlCode,
      title: control.title,
      summary: control.description || '',
      evidence,
      testComponents: (control.testComponents || []).map((item) => item.requirement),
    };
  }

  private async findByIsoMapping(controlCode: string) {
    const variants = toIsoVariants(controlCode);
    const controls = await this.prisma.controlDefinition.findMany({
      include: { testComponents: true, frameworkMappings: { select: { framework: true } } },
    });

    return (
      controls.find((control) => {
        const mappings = Array.isArray(control.isoMappings) ? (control.isoMappings as string[]) : [];
        return mappings.some((value) => variants.includes(String(value)));
      }) || null
    );
  }

  private isControlAllowed(control: { frameworkMappings?: Array<{ framework: string }> }, active: Set<string>) {
    if (!active.size) return false;
    const mappings = control.frameworkMappings || [];
    if (!mappings.length) return true;
    return mappings.some((mapping) => active.has(mapping.framework));
  }

  private buildFrameworkReferences(mappings: unknown) {
    const codes = new Set<string>();
    let detectedVersion = '';
    const list = Array.isArray(mappings) ? mappings : [];
    for (const mapping of list) {
      if (!mapping || typeof mapping !== 'object') continue;
      const name =
        'framework' in mapping ? String((mapping as { framework?: string | null }).framework || '').trim() : '';
      if (!name) continue;
      const code =
        'frameworkCode' in mapping
          ? String((mapping as { frameworkCode?: string | null }).frameworkCode || '').trim()
          : '';
      const frameworkRef =
        'frameworkRef' in mapping
          ? (mapping as { frameworkRef?: { version?: string | null } | null }).frameworkRef
          : null;
      if (code) codes.add(code);
      if (!detectedVersion) {
        const version = this.normalizeFrameworkVersion(frameworkRef?.version, name);
        if (version) detectedVersion = version;
      }
    }

    if (codes.size) {
      return Array.from(codes.values());
    }

    const versionLabel = this.formatVersionLabel(detectedVersion);
    return versionLabel ? [versionLabel] : [];
  }

  private normalizeFrameworkVersion(version?: string | null, frameworkName?: string | null) {
    const raw = String(version || '').trim();
    if (raw) return raw;
    const name = String(frameworkName || '');
    const match = name.match(/\b(v?\d{4})\b/i);
    return match ? match[1] : '';
  }

  private formatVersionLabel(version?: string | null) {
    const raw = String(version || '').trim();
    if (!raw) return '';
    return /^v/i.test(raw) ? raw : `v${raw}`;
  }

  private collectEvidence(testComponents: Array<{ evidenceTypes: unknown }>) {
    const evidence = new Set<string>();
    for (const item of testComponents) {
      const raw = item.evidenceTypes;
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (!entry) continue;
          if (typeof entry === 'string') {
            evidence.add(entry);
          } else if (typeof entry === 'object' && 'name' in entry) {
            const name = String((entry as any).name || '').trim();
            if (name) evidence.add(name);
          }
        }
      } else if (typeof raw === 'string') {
        raw
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .forEach((value) => evidence.add(value));
      }
    }
    return Array.from(evidence.values());
  }
}
