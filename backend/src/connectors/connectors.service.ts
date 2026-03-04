import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.service';
import { EvidenceService } from '../evidence/evidence.service';

@Injectable()
export class ConnectorsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly evidence: EvidenceService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  async listConnectors() {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, name, type, status, createdById, createdAt, updatedAt
      FROM "Connector"
      ORDER BY datetime(createdAt) DESC
    `;
    return rows;
  }

  async createConnector(params: {
    actor: AuthUser;
    name: string;
    type: string;
    config?: unknown;
  }) {
    const name = String(params.name || '').trim();
    const type = String(params.type || '').trim().toUpperCase();
    if (!name || !type) throw new BadRequestException('name and type are required');

    const id = randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO "Connector" (
        id,
        name,
        type,
        configJson,
        status,
        createdById,
        createdAt,
        updatedAt
      ) VALUES (
        ${id},
        ${name},
        ${type},
        ${JSON.stringify(params.config || {})},
        'ACTIVE',
        ${params.actor.id},
        datetime('now'),
        datetime('now')
      )
    `;

    await this.audit.log({
      actorId: params.actor.id,
      actorRole: params.actor.role,
      actionType: 'CONNECTOR_CREATED',
      entityType: 'Connector',
      entityId: id,
      before: null,
      after: { name, type },
    });

    return { id, name, type, status: 'ACTIVE' };
  }

  async runConnector(params: {
    actor: AuthUser;
    connectorId: string;
    artifacts?: Array<{
      type?: string;
      source?: string;
      timestamp?: string;
      rawPayloadRef?: string;
      parsedSummary?: unknown;
    }>;
  }) {
    const connectorId = String(params.connectorId || '').trim();
    if (!connectorId) throw new BadRequestException('connectorId is required');

    const connector = await this.prisma.$queryRaw<any[]>`
      SELECT id, name, type
      FROM "Connector"
      WHERE id = ${connectorId}
      LIMIT 1
    `;
    if (!connector.length) throw new NotFoundException('Connector not found');

    const runId = randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO "ConnectorRun" (
        id,
        connectorId,
        status,
        startedAt,
        endedAt,
        statsJson,
        errorText,
        createdAt
      ) VALUES (
        ${runId},
        ${connectorId},
        'SUCCEEDED',
        datetime('now'),
        datetime('now'),
        ${JSON.stringify({ startedBy: params.actor.id })},
        null,
        datetime('now')
      )
    `;

    const artifacts = Array.isArray(params.artifacts) && params.artifacts.length
      ? params.artifacts
      : [
          {
            type: connector[0].type === 'GITHUB' ? 'SDLC_SIGNAL' : 'IDENTITY_SIGNAL',
            source: connector[0].name,
            timestamp: new Date().toISOString(),
        parsedSummary: {
          generated: true,
          note: 'Sample artifact from manual run',
        },
        rawPayloadRef: undefined,
      },
    ];

    const artifactIds: string[] = [];
    for (const artifact of artifacts) {
      const artifactId = randomUUID();
      artifactIds.push(artifactId);
      await this.prisma.$executeRaw`
        INSERT INTO "ConnectorArtifact" (
          id,
          connectorId,
          runId,
          type,
          source,
          timestamp,
          rawPayloadRef,
          parsedSummaryJson,
          evidenceId,
          createdAt
        ) VALUES (
          ${artifactId},
          ${connectorId},
          ${runId},
          ${String(artifact.type || 'GENERIC_SIGNAL').trim().toUpperCase()},
          ${String(artifact.source || connector[0].name || '').trim() || null},
          ${new Date(String(artifact.timestamp || new Date().toISOString())).toISOString()},
          ${String(artifact.rawPayloadRef || '').trim() || null},
          ${JSON.stringify(artifact.parsedSummary || {})},
          null,
          datetime('now')
        )
      `;
    }

    await this.audit.log({
      actorId: params.actor.id,
      actorRole: params.actor.role,
      actionType: 'CONNECTOR_RUN_EXECUTED',
      entityType: 'ConnectorRun',
      entityId: runId,
      after: {
        connectorId,
        artifacts: artifactIds.length,
      },
    });

    return {
      runId,
      connectorId,
      artifactsCreated: artifactIds.length,
      artifactIds,
    };
  }

  async listArtifacts(connectorId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        id,
        connectorId,
        runId,
        type,
        source,
        timestamp,
        rawPayloadRef,
        parsedSummaryJson,
        evidenceId,
        createdAt
      FROM "ConnectorArtifact"
      WHERE connectorId = ${connectorId}
      ORDER BY datetime(createdAt) DESC
      LIMIT 500
    `;
    return rows.map((row) => ({
      ...row,
      parsedSummary: this.tryParse(row.parsedSummaryJson),
    }));
  }

  async convertArtifactToEvidence(params: {
    actor: AuthUser;
    artifactId: string;
    controlId?: string;
  }) {
    const artifactId = String(params.artifactId || '').trim();
    if (!artifactId) throw new BadRequestException('artifactId is required');

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        id,
        connectorId,
        type,
        source,
        timestamp,
        parsedSummaryJson,
        evidenceId
      FROM "ConnectorArtifact"
      WHERE id = ${artifactId}
      LIMIT 1
    `;
    const artifact = rows[0];
    if (!artifact) throw new NotFoundException('Connector artifact not found');
    if (artifact.evidenceId) {
      return { created: false, evidenceId: artifact.evidenceId };
    }

    const evidenceId = randomUUID();
    const title = `${artifact.type || 'Artifact'} from ${artifact.source || 'connector'}`;
    await this.prisma.$executeRaw`
      INSERT INTO "Evidence" (
        id,
        title,
        type,
        source,
        documentId,
        url,
        createdById,
        status,
        createdAt,
        updatedAt
      ) VALUES (
        ${evidenceId},
        ${title},
        ${artifact.type || 'connector-artifact'},
        'connector',
        null,
        null,
        ${params.actor.id},
        'SUBMITTED',
        datetime('now'),
        datetime('now')
      )
    `;

    await this.prisma.$executeRaw`
      UPDATE "ConnectorArtifact"
      SET evidenceId = ${evidenceId}
      WHERE id = ${artifactId}
    `;

    const controlId = String(params.controlId || '').trim();
    if (controlId) {
      await this.evidence.linkEvidenceToControl({
        evidenceId,
        controlId,
        actor: params.actor,
        reason: 'Linked from connector artifact conversion',
      });
    } else {
      await this.evidence.recomputeEvidenceQuality({
        evidenceId,
        actor: params.actor,
        reason: 'CONNECTOR_ARTIFACT_CONVERTED_TO_EVIDENCE',
        force: true,
      });
    }

    await this.audit.log({
      actorId: params.actor.id,
      actorRole: params.actor.role,
      actionType: 'CONNECTOR_ARTIFACT_CONVERTED_TO_EVIDENCE',
      entityType: 'ConnectorArtifact',
      entityId: artifactId,
      after: { evidenceId, controlId: controlId || null },
    });

    return { created: true, evidenceId };
  }

  private tryParse(value: unknown) {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private async ensureSchema() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Connector" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        configJson TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        createdById TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Connector_type_idx"
      ON "Connector"(type)
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ConnectorRun" (
        id TEXT PRIMARY KEY,
        connectorId TEXT NOT NULL,
        status TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        endedAt TEXT,
        statsJson TEXT,
        errorText TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (connectorId) REFERENCES "Connector"(id) ON DELETE CASCADE
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ConnectorRun_connector_idx"
      ON "ConnectorRun"(connectorId, startedAt)
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ConnectorArtifact" (
        id TEXT PRIMARY KEY,
        connectorId TEXT NOT NULL,
        runId TEXT,
        type TEXT NOT NULL,
        source TEXT,
        timestamp TEXT NOT NULL,
        rawPayloadRef TEXT,
        parsedSummaryJson TEXT,
        evidenceId TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (connectorId) REFERENCES "Connector"(id) ON DELETE CASCADE,
        FOREIGN KEY (runId) REFERENCES "ConnectorRun"(id) ON DELETE SET NULL,
        FOREIGN KEY (evidenceId) REFERENCES "Evidence"(id) ON DELETE SET NULL
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ConnectorArtifact_connector_idx"
      ON "ConnectorArtifact"(connectorId, createdAt)
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ConnectorArtifact_evidence_idx"
      ON "ConnectorArtifact"(evidenceId)
    `);
  }
}
