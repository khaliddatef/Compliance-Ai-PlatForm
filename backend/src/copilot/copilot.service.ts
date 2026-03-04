import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth/auth.service';
import { PolicyService } from '../access-control/policy.service';
import { EvidenceService } from '../evidence/evidence.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export type CopilotActionType =
  | 'CREATE_EVIDENCE_REQUEST'
  | 'LINK_EVIDENCE_CONTROL'
  | 'CREATE_REMEDIATION_TASK';

@Injectable()
export class CopilotService implements OnModuleInit {
  constructor(
    private readonly policy: PolicyService,
    private readonly evidence: EvidenceService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  async executeAction(params: {
    actor: AuthUser;
    actionType: CopilotActionType;
    payload: any;
    dryRun?: boolean;
    requestId?: string | null;
  }) {
    this.policy.assertManagerOrAdmin(params.actor, 'Manager or Admin access required');
    const actionType = String(params.actionType || '').trim().toUpperCase() as CopilotActionType;
    const dryRun = Boolean(params.dryRun);

    if (
      actionType !== 'CREATE_EVIDENCE_REQUEST' &&
      actionType !== 'LINK_EVIDENCE_CONTROL' &&
      actionType !== 'CREATE_REMEDIATION_TASK'
    ) {
      throw new BadRequestException('Unsupported actionType');
    }

    let result: any;

    if (actionType === 'CREATE_EVIDENCE_REQUEST') {
      const controlId = String(params.payload?.controlId || '').trim();
      const ownerId = String(params.payload?.ownerId || params.actor.id).trim();
      const dueDate = String(params.payload?.dueDate || '').trim();
      const testComponentId = String(params.payload?.testComponentId || '').trim() || null;
      if (!controlId || !dueDate) {
        throw new BadRequestException('controlId and dueDate are required');
      }
      const dedupKey = String(params.payload?.dedupKey || '').trim() || null;
      if (dryRun) {
        result = {
          preview: {
            controlId,
            ownerId,
            dueDate,
            testComponentId,
            dedupKey,
          },
        };
      } else {
        result = await this.evidence.createRequest({
          actor: params.actor,
          input: {
            controlId,
            ownerId,
            dueDate,
            testComponentId,
            dedupKey,
          },
          reason: 'Created by copilot action',
          requestId: params.requestId || null,
        });
      }
    }

    if (actionType === 'LINK_EVIDENCE_CONTROL') {
      const evidenceId = String(params.payload?.evidenceId || '').trim();
      const controlId = String(params.payload?.controlId || '').trim();
      if (!evidenceId || !controlId) {
        throw new BadRequestException('evidenceId and controlId are required');
      }
      if (dryRun) {
        result = {
          preview: {
            evidenceId,
            controlId,
          },
        };
      } else {
        result = await this.evidence.linkEvidenceToControl({
          evidenceId,
          controlId,
          actor: params.actor,
          reason: 'Linked by copilot action',
          requestId: params.requestId || null,
        });
      }
    }

    if (actionType === 'CREATE_REMEDIATION_TASK') {
      const title = String(params.payload?.title || '').trim();
      const description = String(params.payload?.description || '').trim() || null;
      const controlId = String(params.payload?.controlId || '').trim() || null;
      const ownerId = String(params.payload?.ownerId || params.actor.id).trim();
      const dueDate = String(params.payload?.dueDate || '').trim() || null;
      if (!title) throw new BadRequestException('title is required');

      if (dryRun) {
        result = {
          preview: {
            title,
            description,
            controlId,
            ownerId,
            dueDate,
            status: 'OPEN',
          },
        };
      } else {
        const taskId = randomUUID();
        await this.prisma.$executeRaw`
          INSERT INTO "RemediationTask" (
            id,
            title,
            description,
            controlId,
            ownerId,
            dueDate,
            status,
            createdById,
            createdAt,
            updatedAt
          ) VALUES (
            ${taskId},
            ${title},
            ${description},
            ${controlId},
            ${ownerId},
            ${dueDate || null},
            'OPEN',
            ${params.actor.id},
            datetime('now'),
            datetime('now')
          )
        `;
        result = {
          created: true,
          taskId,
        };
      }
    }

    await this.audit.log({
      actorId: params.actor.id,
      actorRole: params.actor.role,
      actionType: dryRun ? 'COPILOT_ACTION_DRY_RUN' : 'COPILOT_ACTION_EXECUTED',
      entityType: 'CopilotAction',
      entityId: actionType,
      before: null,
      after: {
        actionType,
        payload: params.payload,
        dryRun,
        result,
      },
      requestId: params.requestId || null,
    });

    return {
      actionType,
      dryRun,
      result,
    };
  }

  buildStructuredResponse(params: {
    framework: string | null;
    status: 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN';
    reply: string;
    missing: string[];
    recommendations: string[];
    citations: Array<{ doc: string; page?: number | null }>;
  }) {
    const statusMap: Record<string, 'Pass' | 'Partial' | 'Fail' | 'Not assessed'> = {
      COMPLIANT: 'Pass',
      PARTIAL: 'Partial',
      NOT_COMPLIANT: 'Fail',
      UNKNOWN: 'Not assessed',
    };
    const status = statusMap[String(params.status || '').toUpperCase()] || 'Not assessed';

    const lines = String(params.reply || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const cards: any[] = [];

    const summaryLines = lines.slice(0, 2);
    if (summaryLines.length) {
      cards.push({
        type: 'summary',
        title: 'Summary',
        lines: summaryLines,
      });
    }

    const gapItems = (params.missing || []).slice(0, 7);
    if (gapItems.length) {
      cards.push({
        type: 'gaps',
        title: 'Gaps',
        items: gapItems,
      });
    }

    const evidenceItems = (params.recommendations || []).slice(0, 5).map((item) => ({
      type: 'Requested evidence',
      example: item,
    }));
    if (evidenceItems.length) {
      cards.push({
        type: 'evidence_needed',
        title: 'Evidence Needed',
        items: evidenceItems,
      });
    }

    const shouldSuggestRemediation =
      (status === 'Partial' || status === 'Fail') && (gapItems.length > 0 || evidenceItems.length > 0);

    const actions = shouldSuggestRemediation
      ? [
          {
            actionType: 'CREATE_REMEDIATION_TASK',
            label: 'Create remediation task',
            payload: {
              title: 'Resolve compliance gaps',
              description: params.reply.slice(0, 300),
            },
          },
        ]
      : [];

    const sources = (params.citations || []).slice(0, 10).map((item) => ({
      objectType: 'Evidence',
      id: item.doc,
      snippetRef: item.page ? `p.${item.page}` : null,
    }));

    return {
      messageType: 'AI_STRUCTURED' as const,
      cards,
      actions,
      sources,
    };
  }

  private async ensureSchema() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RemediationTask" (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        controlId TEXT,
        ownerId TEXT,
        dueDate TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN',
        createdById TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (controlId) REFERENCES "ControlDefinition"(id) ON DELETE SET NULL
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "RemediationTask_control_status_idx"
      ON "RemediationTask"(controlId, status)
    `);
  }
}
