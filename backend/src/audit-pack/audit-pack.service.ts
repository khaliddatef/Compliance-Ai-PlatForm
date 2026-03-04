import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.service';
import { buildZip } from './zip.util';

type GenerateAuditPackInput = {
  frameworkId?: string | null;
  periodStart: string;
  periodEnd: string;
};

const parseRequiredDate = (value: string, field: string) => {
  const date = new Date(String(value || '').trim());
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return date;
};

const toJson = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ fallback: String(value) });
  }
};

@Injectable()
export class AuditPackService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  async generatePack(params: {
    actor: AuthUser;
    input: GenerateAuditPackInput;
    requestId?: string | null;
  }) {
    const periodStart = parseRequiredDate(params.input.periodStart, 'periodStart');
    const periodEnd = parseRequiredDate(params.input.periodEnd, 'periodEnd');
    if (periodEnd < periodStart) {
      throw new BadRequestException('periodEnd must be on/after periodStart');
    }
    const frameworkId = String(params.input.frameworkId || '').trim() || null;

    const packId = randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO "AuditPack" (
        id,
        frameworkId,
        periodStart,
        periodEnd,
        createdById,
        createdAt
      ) VALUES (
        ${packId},
        ${frameworkId},
        ${periodStart.toISOString()},
        ${periodEnd.toISOString()},
        ${params.actor.id},
        datetime('now')
      )
    `;

    const controls = await this.prisma.$queryRaw<any[]>`
      SELECT
        cd.id,
        cd.controlCode,
        cd.title,
        cd.ownerRole,
        (
          SELECT COUNT(1)
          FROM "TestComponent" tc
          WHERE tc.controlId = cd.id
        ) AS requiredEvidenceCount,
        (
          SELECT COUNT(DISTINCT e.id)
          FROM "EvidenceControlLink" l
          INNER JOIN "Evidence" e ON e.id = l.evidenceId
          WHERE l.controlId = cd.id
            AND e.status = 'ACCEPTED'
            AND (e.validTo IS NULL OR datetime(e.validTo) >= datetime('now'))
        ) AS acceptedEvidenceCount
      FROM "ControlDefinition" cd
      WHERE (
        ${frameworkId || ''} = ''
        OR EXISTS (
          SELECT 1
          FROM "ControlFrameworkMapping" fm
          WHERE fm.controlId = cd.id
            AND (
              fm.frameworkId = ${frameworkId}
              OR lower(fm.framework) = lower(${frameworkId})
            )
        )
      )
      ORDER BY cd.controlCode ASC
    `;

    const evidenceRows = await this.prisma.$queryRaw<any[]>`
      SELECT
        e.id,
        e.title,
        e.type,
        e.source,
        e.status,
        e.reviewedAt,
        e.validTo,
        e.documentId,
        d.originalName AS documentName,
        d.storagePath AS storagePath
      FROM "Evidence" e
      LEFT JOIN "Document" d ON d.id = e.documentId
      ORDER BY datetime(e.createdAt) DESC
    `;

    const requestRows = await this.prisma.$queryRaw<any[]>`
      SELECT
        r.id,
        r.controlId,
        r.ownerId,
        r.status,
        r.dueDate,
        r.createdAt,
        r.updatedAt
      FROM "ControlEvidenceRequest" r
      ORDER BY datetime(r.createdAt) DESC
    `;

    const items: Array<{
      type: 'Control' | 'Evidence' | 'Request';
      refId: string;
      snapshotData: any;
    }> = [];

    for (const control of controls) {
      const required = Number(control.requiredEvidenceCount || 0);
      const accepted = Number(control.acceptedEvidenceCount || 0);
      const status = required === 0 ? 'NOT_ASSESSED' : accepted >= required ? 'PASS' : accepted > 0 ? 'PARTIAL' : 'FAIL';
      items.push({
        type: 'Control',
        refId: control.id,
        snapshotData: {
          controlId: control.id,
          controlCode: control.controlCode,
          title: control.title,
          ownerRole: control.ownerRole || null,
          evidenceCompleteness: `${accepted}/${required}`,
          status,
        },
      });
    }

    for (const evidence of evidenceRows) {
      items.push({
        type: 'Evidence',
        refId: evidence.id,
        snapshotData: {
          evidenceId: evidence.id,
          title: evidence.title,
          type: evidence.type,
          source: evidence.source,
          status: evidence.status,
          reviewedAt: evidence.reviewedAt || null,
          validTo: evidence.validTo || null,
          documentId: evidence.documentId || null,
          documentName: evidence.documentName || null,
          storagePath: evidence.storagePath || null,
        },
      });
    }

    for (const request of requestRows) {
      items.push({
        type: 'Request',
        refId: request.id,
        snapshotData: {
          requestId: request.id,
          controlId: request.controlId,
          ownerId: request.ownerId,
          status: request.status,
          dueDate: request.dueDate,
          createdAt: request.createdAt,
          updatedAt: request.updatedAt,
        },
      });
    }

    for (const item of items) {
      await this.prisma.$executeRaw`
        INSERT INTO "AuditPackItem" (
          id,
          auditPackId,
          type,
          refId,
          snapshotData,
          createdAt
        ) VALUES (
          ${randomUUID()},
          ${packId},
          ${item.type},
          ${item.refId},
          ${toJson(item.snapshotData)},
          datetime('now')
        )
      `;
    }

    await this.audit.log({
      actorId: params.actor.id,
      actorRole: params.actor.role,
      actionType: 'AUDIT_PACK_GENERATED',
      entityType: 'AuditPack',
      entityId: packId,
      before: null,
      after: {
        frameworkId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        items: items.length,
      },
      requestId: params.requestId || null,
    });

    return this.getPack(packId);
  }

  async getPack(packId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        ap.id,
        ap.frameworkId,
        ap.periodStart,
        ap.periodEnd,
        ap.createdById,
        ap.createdAt,
        (SELECT COUNT(1) FROM "AuditPackItem" api WHERE api.auditPackId = ap.id) AS itemCount
      FROM "AuditPack" ap
      WHERE ap.id = ${packId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Audit pack not found');
    return {
      id: row.id,
      frameworkId: row.frameworkId || null,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      createdById: row.createdById,
      createdAt: row.createdAt,
      itemCount: Number(row.itemCount || 0),
    };
  }

  async buildCsv(packId: string) {
    const pack = await this.getPack(packId);
    const items = await this.getPackItems(packId);

    const lines = [
      ['type', 'refId', 'status', 'title', 'controlCode', 'ownerRole', 'dueDate', 'reviewedAt', 'validTo'].join(','),
    ];

    for (const item of items) {
      const data = item.snapshotData || {};
      lines.push([
        item.type,
        item.refId,
        this.csvValue(data.status || ''),
        this.csvValue(data.title || ''),
        this.csvValue(data.controlCode || ''),
        this.csvValue(data.ownerRole || ''),
        this.csvValue(data.dueDate || ''),
        this.csvValue(data.reviewedAt || ''),
        this.csvValue(data.validTo || ''),
      ].join(','));
    }

    return {
      filename: `audit-pack-${pack.id}.csv`,
      content: lines.join('\n'),
      pack,
      itemsCount: items.length,
    };
  }

  async buildZip(packId: string) {
    const csv = await this.buildCsv(packId);
    const items = await this.getPackItems(packId);
    const entries: Array<{ name: string; content: Buffer | string }> = [
      {
        name: csv.filename,
        content: csv.content,
      },
      {
        name: 'manifest.json',
        content: JSON.stringify({
          generatedAt: new Date().toISOString(),
          pack: csv.pack,
          itemsCount: items.length,
        }, null, 2),
      },
    ];

    let copiedFiles = 0;
    const missingFiles: string[] = [];
    for (const item of items) {
      if (item.type !== 'Evidence') continue;
      const storagePath = String(item.snapshotData?.storagePath || '').trim();
      const documentName = String(item.snapshotData?.documentName || item.refId || '').trim() || `${item.refId}.bin`;
      if (!storagePath) continue;
      const resolved = path.isAbsolute(storagePath) ? storagePath : path.resolve(process.cwd(), storagePath);
      try {
        const content = await fs.readFile(resolved);
        entries.push({
          name: `evidence/${documentName.replace(/[^\w.\-]+/g, '_')}`,
          content,
        });
        copiedFiles += 1;
      } catch {
        missingFiles.push(resolved);
      }
    }

    entries.push({
      name: 'warnings.json',
      content: JSON.stringify({
        missingFiles,
      }, null, 2),
    });

    return {
      filename: `audit-pack-${packId}.zip`,
      content: buildZip(entries),
      copiedFiles,
      missingFiles,
    };
  }

  private async getPackItems(packId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        id,
        type,
        refId,
        snapshotData,
        createdAt
      FROM "AuditPackItem"
      WHERE auditPackId = ${packId}
      ORDER BY datetime(createdAt) ASC
    `;

    return rows.map((row) => ({
      id: row.id,
      type: row.type as 'Control' | 'Evidence' | 'Request',
      refId: row.refId,
      snapshotData: this.tryParse(row.snapshotData),
      createdAt: row.createdAt,
    }));
  }

  private tryParse(value: unknown) {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private csvValue(value: string) {
    const normalized = String(value || '');
    if (!/[,"\n]/.test(normalized)) return normalized;
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  private async ensureSchema() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AuditPack" (
        id TEXT PRIMARY KEY,
        frameworkId TEXT,
        periodStart TEXT NOT NULL,
        periodEnd TEXT NOT NULL,
        createdById TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "AuditPack_createdAt_idx"
      ON "AuditPack"(createdAt)
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AuditPackItem" (
        id TEXT PRIMARY KEY,
        auditPackId TEXT NOT NULL,
        type TEXT NOT NULL,
        refId TEXT NOT NULL,
        snapshotData TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (auditPackId) REFERENCES "AuditPack"(id) ON DELETE CASCADE
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "AuditPackItem_pack_idx"
      ON "AuditPackItem"(auditPackId)
    `);
  }
}

