import { Injectable } from '@nestjs/common';
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

@Injectable()
export class ControlKbService {
  constructor(private readonly prisma: PrismaService) {}

  async listTopics(standard: string) {
    const topics = await this.prisma.controlTopic.findMany({
      where: { standard },
      orderBy: [{ priority: 'desc' }, { title: 'asc' }],
      include: { _count: { select: { controls: true } } },
    });

    return topics.map((topic) => ({
      ...topic,
      controlCount: topic._count.controls,
    }));
  }

  async createTopic(input: {
    standard: string;
    title: string;
    description?: string | null;
    mode?: string | null;
    status?: string | null;
    priority?: number | null;
  }) {
    return this.prisma.controlTopic.create({
      data: {
        standard: input.standard,
        title: input.title,
        description: input.description || null,
        mode: input.mode || 'continuous',
        status: input.status || 'enabled',
        priority: typeof input.priority === 'number' ? input.priority : 0,
      },
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
    return this.prisma.controlTopic.delete({ where: { id } });
  }

  async listControls(params: {
    standard: string;
    topicId?: string | null;
    query?: string | null;
    page?: number;
    pageSize?: number;
  }) {
    const where: any = params.topicId
      ? { topicId: params.topicId }
      : { topic: { standard: params.standard } };

    if (params.query) {
      const q = params.query.trim();
      if (q) {
        where.OR = [
          { controlCode: { contains: q, mode: 'insensitive' } },
          { title: { contains: q, mode: 'insensitive' } },
        ];
      }
    }

    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(Math.max(params.pageSize || 10, 1), 10);
    const skip = (page - 1) * pageSize;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.controlDefinition.count({ where }),
      this.prisma.controlDefinition.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { controlCode: 'asc' }],
        skip,
        take: pageSize,
        select: {
          id: true,
          topicId: true,
          controlCode: true,
          title: true,
          description: true,
          isoMappings: true,
          ownerRole: true,
          status: true,
          sortOrder: true,
          _count: { select: { testComponents: true } },
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  async listControlCatalog(standard: string) {
    const controls = await this.prisma.controlDefinition.findMany({
      where: { topic: { standard } },
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

  async getControl(id: string) {
    return this.prisma.controlDefinition.findUnique({
      where: { id },
      include: { testComponents: { orderBy: { sortOrder: 'asc' } }, topic: true },
    });
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
  }) {
    return this.prisma.controlDefinition.create({
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
  }

  async updateControl(
    id: string,
    input: {
      controlCode?: string;
      title?: string;
      description?: string | null;
      isoMappings?: string[] | null;
      ownerRole?: string | null;
      status?: string | null;
      sortOrder?: number | null;
    },
  ) {
    return this.prisma.controlDefinition.update({
      where: { id },
      data: {
        controlCode: input.controlCode,
        title: input.title,
        description: input.description ?? undefined,
        isoMappings: input.isoMappings ?? undefined,
        ownerRole: input.ownerRole ?? undefined,
        status: input.status ?? undefined,
        sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : undefined,
      },
    });
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

  async getControlContextByCode(params: { controlCode: string; standard: string }): Promise<ControlContext | null> {
    const controlCode = params.controlCode?.trim();
    if (!controlCode) return null;

    const direct = await this.prisma.controlDefinition.findFirst({
      where: {
        controlCode,
        topic: { standard: params.standard },
      },
      include: { testComponents: true },
    });

    const control = direct || (await this.findByIsoMapping(controlCode, params.standard));
    if (!control) return null;

    const evidence = this.collectEvidence(control.testComponents || []);

    return {
      id: control.controlCode,
      title: control.title,
      summary: control.description || '',
      evidence,
      testComponents: (control.testComponents || []).map((item) => item.requirement),
    };
  }

  private async findByIsoMapping(controlCode: string, standard: string) {
    const variants = toIsoVariants(controlCode);
    const controls = await this.prisma.controlDefinition.findMany({
      where: { topic: { standard } },
      include: { testComponents: true },
    });

    return (
      controls.find((control) => {
        const mappings = Array.isArray(control.isoMappings) ? (control.isoMappings as string[]) : [];
        return mappings.some((value) => variants.includes(String(value)));
      }) || null
    );
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
