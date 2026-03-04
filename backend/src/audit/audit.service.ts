import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

type AuditEventInput = {
  actorId?: string | null;
  actorRole?: string | null;
  actionType: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestId?: string | null;
};

type AuditQuery = {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  actionType?: string;
  limit?: number;
  offset?: number;
};

const toJson = (value: unknown) => {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ fallback: String(value) });
  }
};

@Injectable()
export class AuditService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  async log(event: AuditEventInput) {
    await this.prisma.$executeRaw`
      INSERT INTO "AuditEvent" (
        id,
        actorId,
        actorRole,
        actionType,
        entityType,
        entityId,
        beforeJson,
        afterJson,
        reason,
        requestId,
        createdAt
      ) VALUES (
        ${randomUUID()},
        ${event.actorId || null},
        ${event.actorRole || null},
        ${event.actionType},
        ${event.entityType},
        ${event.entityId},
        ${toJson(event.before)},
        ${toJson(event.after)},
        ${event.reason || null},
        ${event.requestId || null},
        datetime('now')
      )
    `;
  }

  async list(query: AuditQuery) {
    const limit = Math.min(Math.max(query.limit || 50, 1), 500);
    const offset = Math.max(query.offset || 0, 0);
    const entityType = String(query.entityType || '').trim();
    const entityId = String(query.entityId || '').trim();
    const actorId = String(query.actorId || '').trim();
    const actionType = String(query.actionType || '').trim();

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        id,
        actorId,
        actorRole,
        actionType,
        entityType,
        entityId,
        beforeJson,
        afterJson,
        reason,
        requestId,
        createdAt
      FROM "AuditEvent"
      WHERE (${entityType} = '' OR entityType = ${entityType})
        AND (${entityId} = '' OR entityId = ${entityId})
        AND (${actorId} = '' OR actorId = ${actorId})
        AND (${actionType} = '' OR actionType = ${actionType})
      ORDER BY datetime(createdAt) DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return rows.map((row) => ({
      id: row.id,
      actorId: row.actorId || null,
      actorRole: row.actorRole || null,
      actionType: row.actionType,
      entityType: row.entityType,
      entityId: row.entityId,
      before: this.tryParseJson(row.beforeJson),
      after: this.tryParseJson(row.afterJson),
      reason: row.reason || null,
      requestId: row.requestId || null,
      createdAt: row.createdAt,
    }));
  }

  private tryParseJson(value: unknown) {
    if (!value || typeof value !== 'string') return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private async ensureSchema() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AuditEvent" (
        id TEXT PRIMARY KEY,
        actorId TEXT,
        actorRole TEXT,
        actionType TEXT NOT NULL,
        entityType TEXT NOT NULL,
        entityId TEXT NOT NULL,
        beforeJson TEXT,
        afterJson TEXT,
        reason TEXT,
        requestId TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "AuditEvent_entity_idx"
      ON "AuditEvent"(entityType, entityId)
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "AuditEvent_actor_idx"
      ON "AuditEvent"(actorId)
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "AuditEvent_createdAt_idx"
      ON "AuditEvent"(createdAt)
    `);
  }
}
