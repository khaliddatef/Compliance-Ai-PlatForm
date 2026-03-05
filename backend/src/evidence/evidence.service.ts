import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PolicyService } from '../access-control/policy.service';
import type { AuthUser } from '../auth/auth.service';
import {
  deriveRequestStatusFromEvidence,
  isEvidenceTransitionAllowed,
} from './evidence-state';
import { EvidenceQualityService } from './evidence-quality.service';

export type EvidenceStatus = 'SUBMITTED' | 'REVIEWED' | 'ACCEPTED' | 'REJECTED';

type CreateRequestInput = {
  controlId: string;
  testComponentId?: string | null;
  ownerId: string;
  dueDate: string;
  dedupKey?: string | null;
};

const EVIDENCE_STATUSES = new Set<EvidenceStatus>(['SUBMITTED', 'REVIEWED', 'ACCEPTED', 'REJECTED']);

@Injectable()
export class EvidenceService implements OnModuleInit {
  private bootstrapChecked = false;
  private bootstrapPromise: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly quality: EvidenceQualityService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
    await this.ensureBootstrappedEvidence();
  }

  async listEvidence(params: {
    user: AuthUser;
    status?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }) {
    await this.ensureBootstrappedEvidence();

    const role = this.policy.normalizeRole(params.user.role);
    const status = String(params.status || '').trim().toUpperCase();
    const q = String(params.q || '').trim().toLowerCase();
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(Math.max(params.pageSize || 20, 1), 200);
    const offset = (page - 1) * pageSize;

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        e.id,
        e.title,
        e.type,
        e.source,
        e.documentId,
        e.url,
        e.status,
        e.createdById,
        e.reviewedById,
        e.reviewedAt,
        e.reviewComment,
        e.validFrom,
        e.validTo,
        e.qualityScore,
        e.qualityGrade,
        e.qualityFactors,
        e.qualityComputedAt,
        e.qualityVersion,
        e.createdAt,
        e.updatedAt,
        d.originalName AS documentName,
        d.matchControlId AS matchControlId,
        u.name AS createdByName,
        (SELECT COUNT(1) FROM "EvidenceControlLink" l WHERE l.evidenceId = e.id) AS linksCount
      FROM "Evidence" e
      LEFT JOIN "Document" d ON d.id = e.documentId
      LEFT JOIN "User" u ON u.id = e.createdById
      LEFT JOIN "Conversation" c ON c.id = d.conversationId
      WHERE (${status} = '' OR e.status = ${status})
        AND (
          ${q} = ''
          OR lower(e.title) LIKE ${`%${q}%`}
          OR lower(COALESCE(e.type, '')) LIKE ${`%${q}%`}
          OR lower(COALESCE(d.originalName, '')) LIKE ${`%${q}%`}
        )
        AND (
          ${role} <> 'USER'
          OR (
            COALESCE(c.userId, e.createdById, '') = ${params.user.id}
          )
        )
      ORDER BY datetime(e.createdAt) DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;

    const totalRows = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(1) AS count
      FROM "Evidence" e
      LEFT JOIN "Document" d ON d.id = e.documentId
      LEFT JOIN "Conversation" c ON c.id = d.conversationId
      WHERE (${status} = '' OR e.status = ${status})
        AND (
          ${q} = ''
          OR lower(e.title) LIKE ${`%${q}%`}
          OR lower(COALESCE(e.type, '')) LIKE ${`%${q}%`}
          OR lower(COALESCE(d.originalName, '')) LIKE ${`%${q}%`}
        )
        AND (
          ${role} <> 'USER'
          OR (
            COALESCE(c.userId, e.createdById, '') = ${params.user.id}
          )
        )
    `;
    const total = Number(totalRows[0]?.count || 0);
    return {
      items: rows.map((row) => this.normalizeEvidenceRow(row)),
      total,
      page,
      pageSize,
    };
  }

  async getEvidenceById(id: string, user: AuthUser) {
    const role = this.policy.normalizeRole(user.role);
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        e.id,
        e.title,
        e.type,
        e.source,
        e.documentId,
        e.url,
        e.status,
        e.createdById,
        e.reviewedById,
        e.reviewedAt,
        e.reviewComment,
        e.validFrom,
        e.validTo,
        e.qualityScore,
        e.qualityGrade,
        e.qualityFactors,
        e.qualityComputedAt,
        e.qualityVersion,
        e.createdAt,
        e.updatedAt,
        d.originalName AS documentName,
        d.matchControlId AS matchControlId,
        c.userId AS conversationUserId
      FROM "Evidence" e
      LEFT JOIN "Document" d ON d.id = e.documentId
      LEFT JOIN "Conversation" c ON c.id = d.conversationId
      WHERE e.id = ${id}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      throw new NotFoundException('Evidence not found');
    }

    if (role === 'USER') {
      const ownerId = String(row.conversationUserId || row.createdById || '').trim();
      if (!ownerId || ownerId !== user.id) {
        throw new ForbiddenException('Not allowed to access this evidence');
      }
    }

    const links = await this.prisma.$queryRaw<any[]>`
      SELECT
        l.id,
        l.controlId,
        l.linkedById,
        l.createdAt,
        cd.controlCode,
        cd.title
      FROM "EvidenceControlLink" l
      LEFT JOIN "ControlDefinition" cd ON cd.id = l.controlId
      WHERE l.evidenceId = ${id}
      ORDER BY datetime(l.createdAt) DESC
    `;

    return {
      ...this.normalizeEvidenceRow(row),
      links: links.map((link) => ({
        id: link.id,
        controlId: link.controlId,
        controlCode: link.controlCode || null,
        controlTitle: link.title || null,
        linkedById: link.linkedById,
        createdAt: link.createdAt,
      })),
    };
  }

  async getEvidenceByDocumentId(documentId: string, user: AuthUser) {
    const docId = String(documentId || '').trim();
    if (!docId) {
      throw new BadRequestException('documentId is required');
    }

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id
      FROM "Evidence"
      WHERE documentId = ${docId}
      LIMIT 1
    `;

    const evidenceId = String(rows[0]?.id || '').trim();
    if (!evidenceId) return null;
    return this.getEvidenceById(evidenceId, user);
  }

  async getEvidenceQuality(params: {
    evidenceId: string;
    user: AuthUser;
    controlId?: string | null;
    testComponentId?: string | null;
  }) {
    await this.getEvidenceById(params.evidenceId, params.user);
    return this.quality.getEvidenceQuality({
      evidenceId: params.evidenceId,
      context: {
        controlId: params.controlId || null,
        testComponentId: params.testComponentId || null,
      },
    });
  }

  async recomputeEvidenceQuality(params: {
    evidenceId: string;
    actor: AuthUser;
    reason?: string | null;
    requestId?: string | null;
    force?: boolean;
  }) {
    this.policy.assertManagerOrAdmin(params.actor, 'Manager or Admin access required for quality recompute');
    await this.getEvidenceById(params.evidenceId, params.actor);
    return this.quality.recomputeEvidenceQuality({
      evidenceId: params.evidenceId,
      actor: params.actor,
      reason: params.reason || null,
      requestId: params.requestId || null,
      force: params.force === true,
    });
  }

  async linkEvidenceToControl(params: {
    evidenceId: string;
    controlId: string;
    actor: AuthUser;
    reason?: string | null;
    requestId?: string | null;
  }) {
    this.policy.assertManagerOrAdmin(params.actor, 'Manager or Admin access required to link evidence');
    const evidenceId = String(params.evidenceId || '').trim();
    const controlId = String(params.controlId || '').trim();
    if (!evidenceId || !controlId) {
      throw new BadRequestException('evidenceId and controlId are required');
    }

    const evidence = await this.prisma.$queryRaw<any[]>`
      SELECT id, documentId
      FROM "Evidence"
      WHERE id = ${evidenceId}
      LIMIT 1
    `;
    if (!evidence.length) throw new NotFoundException('Evidence not found');

    const control = await this.prisma.$queryRaw<any[]>`
      SELECT id, controlCode
      FROM "ControlDefinition"
      WHERE id = ${controlId}
      LIMIT 1
    `;
    if (!control.length) throw new NotFoundException('Control not found');

    const existing = await this.prisma.$queryRaw<any[]>`
      SELECT id
      FROM "EvidenceControlLink"
      WHERE evidenceId = ${evidenceId} AND controlId = ${controlId}
      LIMIT 1
    `;
    if (existing.length) {
      return {
        created: false,
        linkId: existing[0].id,
      };
    }

    const linkId = randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO "EvidenceControlLink" (
        id,
        evidenceId,
        controlId,
        linkedById,
        createdAt
      ) VALUES (
        ${linkId},
        ${evidenceId},
        ${controlId},
        ${params.actor.id},
        datetime('now')
      )
    `;

    await this.audit.log({
      actorId: params.actor.id,
      actorRole: params.actor.role,
      actionType: 'EVIDENCE_LINK_CREATED',
      entityType: 'EvidenceControlLink',
      entityId: linkId,
      before: null,
      after: { evidenceId, controlId },
      reason: params.reason || null,
      requestId: params.requestId || null,
    });

    await this.quality.recomputeEvidenceQuality({
      evidenceId,
      actor: params.actor,
      reason: 'EVIDENCE_LINK_CREATED',
      requestId: params.requestId || null,
      force: false,
    });

    const documentId = String(evidence[0]?.documentId || '').trim();
    const linkedControlCode = String(control[0]?.controlCode || '').trim();
    if (documentId && linkedControlCode) {
      const docRows = await this.prisma.$queryRaw<any[]>`
        SELECT id, matchControlId
        FROM "Document"
        WHERE id = ${documentId}
        LIMIT 1
      `;
      const doc = docRows[0];
      const currentMatchControl = String(doc?.matchControlId || '').trim();
      if (doc?.id && !currentMatchControl) {
        await this.prisma.$executeRaw`
          UPDATE "Document"
          SET matchControlId = ${linkedControlCode}
          WHERE id = ${documentId}
        `;
        await this.audit.log({
          actorId: params.actor.id,
          actorRole: params.actor.role,
          actionType: 'DOCUMENT_CONTROL_MAPPED_FROM_EVIDENCE_LINK',
          entityType: 'Document',
          entityId: documentId,
          before: { matchControlId: null },
          after: { matchControlId: linkedControlCode },
          reason: params.reason || 'Synced from evidence link',
          requestId: params.requestId || null,
        });
      }
    }

    return {
      created: true,
      linkId,
    };
  }

  async deleteEvidenceLink(params: {
    linkId: string;
    actor: AuthUser;
    reason?: string | null;
    requestId?: string | null;
  }) {
    this.policy.assertManagerOrAdmin(params.actor, 'Manager or Admin access required to unlink evidence');
    const linkId = String(params.linkId || '').trim();
    if (!linkId) throw new BadRequestException('linkId is required');

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, evidenceId, controlId
      FROM "EvidenceControlLink"
      WHERE id = ${linkId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Evidence link not found');

    await this.prisma.$executeRaw`
      DELETE FROM "EvidenceControlLink"
      WHERE id = ${linkId}
    `;

    await this.audit.log({
      actorId: params.actor.id,
      actorRole: params.actor.role,
      actionType: 'EVIDENCE_LINK_DELETED',
      entityType: 'EvidenceControlLink',
      entityId: row.id,
      before: { evidenceId: row.evidenceId, controlId: row.controlId },
      after: null,
      reason: params.reason || null,
      requestId: params.requestId || null,
    });

    await this.quality.recomputeEvidenceQuality({
      evidenceId: String(row.evidenceId || ''),
      actor: params.actor,
      reason: 'EVIDENCE_LINK_DELETED',
      requestId: params.requestId || null,
      force: false,
    });

    return { ok: true };
  }

  async reviewEvidence(params: {
    evidenceId: string;
    actor: AuthUser;
    status: string;
    reviewComment?: string | null;
    validFrom?: string | null;
    validTo?: string | null;
    reason?: string | null;
    requestId?: string | null;
  }) {
    this.policy.assertManagerOrAdmin(params.actor, 'Manager or Admin access required for evidence review');
    const evidenceId = String(params.evidenceId || '').trim();
    const status = String(params.status || '').trim().toUpperCase() as EvidenceStatus;
    if (!evidenceId) throw new BadRequestException('evidenceId is required');
    if (!EVIDENCE_STATUSES.has(status)) throw new BadRequestException('Invalid evidence status');

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, status, reviewComment, validFrom, validTo
      FROM "Evidence"
      WHERE id = ${evidenceId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Evidence not found');

    const current = String(row.status || 'SUBMITTED').toUpperCase() as EvidenceStatus;
    if (!isEvidenceTransitionAllowed(current, status)) {
      throw new BadRequestException(`Transition ${current} -> ${status} is not allowed`);
    }

    if ((status === 'ACCEPTED' || status === 'REJECTED') && !String(params.reviewComment || '').trim()) {
      throw new BadRequestException('reviewComment is required for ACCEPTED/REJECTED');
    }

    const validFrom = this.toNullableDate(params.validFrom);
    const validTo = this.toNullableDate(params.validTo);
    if (validFrom && validTo && validTo < validFrom) {
      throw new BadRequestException('validTo cannot be before validFrom');
    }

    await this.prisma.$executeRaw`
      UPDATE "Evidence"
      SET
        status = ${status},
        reviewedById = ${params.actor.id},
        reviewedAt = datetime('now'),
        reviewComment = ${String(params.reviewComment || '').trim() || null},
        validFrom = ${validFrom},
        validTo = ${validTo},
        updatedAt = datetime('now')
      WHERE id = ${evidenceId}
    `;

    await this.syncRequestsForEvidence(evidenceId);
    await this.quality.recomputeEvidenceQuality({
      evidenceId,
      actor: params.actor,
      reason: 'EVIDENCE_REVIEW_UPDATED',
      requestId: params.requestId || null,
      force: true,
    });

    const updated = await this.getEvidenceById(evidenceId, params.actor);
    await this.audit.log({
      actorId: params.actor.id,
      actorRole: params.actor.role,
      actionType: 'EVIDENCE_REVIEW_UPDATED',
      entityType: 'Evidence',
      entityId: evidenceId,
      before: row,
      after: updated,
      reason: params.reason || null,
      requestId: params.requestId || null,
    });
    return updated;
  }

  async listRequests(params: {
    user: AuthUser;
    status?: string;
    ownerId?: string;
    controlId?: string;
    page?: number;
    pageSize?: number;
  }) {
    await this.markOverdueRequests();

    const status = String(params.status || '').trim().toUpperCase();
    const ownerId = String(params.ownerId || '').trim();
    const controlId = String(params.controlId || '').trim();
    const role = this.policy.normalizeRole(params.user.role);
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(Math.max(params.pageSize || 20, 1), 200);
    const offset = (page - 1) * pageSize;

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        r.id,
        r.controlId,
        r.testComponentId,
        r.ownerId,
        r.dueDate,
        r.status,
        r.createdById,
        r.createdAt,
        r.updatedAt,
        r.closedAt,
        r.dedupKey,
        c.controlCode,
        c.title AS controlTitle,
        tc.requirement AS testComponentRequirement,
        u.name AS ownerName,
        (SELECT COUNT(1) FROM "EvidenceRequestFulfillment" f WHERE f.requestId = r.id) AS fulfillmentCount
      FROM "ControlEvidenceRequest" r
      LEFT JOIN "ControlDefinition" c ON c.id = r.controlId
      LEFT JOIN "TestComponent" tc ON tc.id = r.testComponentId
      LEFT JOIN "User" u ON u.id = r.ownerId
      WHERE (${status} = '' OR r.status = ${status})
        AND (${ownerId} = '' OR r.ownerId = ${ownerId})
        AND (${controlId} = '' OR r.controlId = ${controlId})
        AND (${role} <> 'USER' OR r.ownerId = ${params.user.id} OR r.createdById = ${params.user.id})
      ORDER BY datetime(r.createdAt) DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;

    const totalRows = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(1) AS count
      FROM "ControlEvidenceRequest" r
      WHERE (${status} = '' OR r.status = ${status})
        AND (${ownerId} = '' OR r.ownerId = ${ownerId})
        AND (${controlId} = '' OR r.controlId = ${controlId})
        AND (${role} <> 'USER' OR r.ownerId = ${params.user.id} OR r.createdById = ${params.user.id})
    `;
    const total = Number(totalRows[0]?.count || 0);

    return {
      items: rows.map((row) => ({
        id: row.id,
        controlId: row.controlId,
        controlCode: row.controlCode || null,
        controlTitle: row.controlTitle || null,
        testComponentId: row.testComponentId || null,
        testComponentRequirement: row.testComponentRequirement || null,
        ownerId: row.ownerId,
        ownerName: row.ownerName || null,
        dueDate: row.dueDate,
        status: String(row.status || '').toUpperCase(),
        createdById: row.createdById,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        closedAt: row.closedAt || null,
        dedupKey: row.dedupKey || null,
        fulfillmentCount: Number(row.fulfillmentCount || 0),
      })),
      total,
      page,
      pageSize,
    };
  }

  async createRequest(params: {
    actor: AuthUser;
    input: CreateRequestInput;
    reason?: string | null;
    requestId?: string | null;
  }) {
    this.policy.assertManagerOrAdmin(params.actor, 'Manager or Admin access required to create evidence requests');

    const input = params.input;
    const controlId = String(input.controlId || '').trim();
    const ownerId = String(input.ownerId || '').trim();
    const testComponentId = String(input.testComponentId || '').trim() || null;
    const dueDate = this.toRequiredDate(input.dueDate, 'dueDate is required');
    const dedupKey = String(input.dedupKey || '').trim() || null;

    if (!controlId || !ownerId) {
      throw new BadRequestException('controlId and ownerId are required');
    }

    const control = await this.prisma.$queryRaw<any[]>`
      SELECT id FROM "ControlDefinition" WHERE id = ${controlId} LIMIT 1
    `;
    if (!control.length) throw new NotFoundException('Control not found');

    if (testComponentId) {
      const component = await this.prisma.$queryRaw<any[]>`
        SELECT id FROM "TestComponent" WHERE id = ${testComponentId} LIMIT 1
      `;
      if (!component.length) throw new NotFoundException('Test component not found');
    }

    const owner = await this.prisma.$queryRaw<any[]>`
      SELECT id FROM "User" WHERE id = ${ownerId} LIMIT 1
    `;
    if (!owner.length) throw new NotFoundException('Owner user not found');

    if (dedupKey) {
      const existing = await this.prisma.$queryRaw<any[]>`
        SELECT id
        FROM "ControlEvidenceRequest"
        WHERE dedupKey = ${dedupKey}
        LIMIT 1
      `;
      if (existing.length) {
        return { created: false, requestId: existing[0].id };
      }
    }

    const id = randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO "ControlEvidenceRequest" (
        id,
        controlId,
        testComponentId,
        ownerId,
        dueDate,
        status,
        createdById,
        dedupKey,
        createdAt,
        updatedAt
      ) VALUES (
        ${id},
        ${controlId},
        ${testComponentId},
        ${ownerId},
        ${dueDate.toISOString()},
        'OPEN',
        ${params.actor.id},
        ${dedupKey},
        datetime('now'),
        datetime('now')
      )
    `;

    const request = await this.getRequestById(id);
    await this.audit.log({
      actorId: params.actor.id,
      actorRole: params.actor.role,
      actionType: 'EVIDENCE_REQUEST_CREATED',
      entityType: 'ControlEvidenceRequest',
      entityId: id,
      before: null,
      after: request,
      reason: params.reason || null,
      requestId: params.requestId || null,
    });

    return { created: true, request };
  }

  async fulfillRequest(params: {
    requestId: string;
    evidenceId: string;
    actor: AuthUser;
    reason?: string | null;
    requestTraceId?: string | null;
  }) {
    const requestId = String(params.requestId || '').trim();
    const evidenceId = String(params.evidenceId || '').trim();
    if (!requestId || !evidenceId) {
      throw new BadRequestException('requestId and evidenceId are required');
    }

    const request = await this.getRequestById(requestId);
    if (!request) throw new NotFoundException('Evidence request not found');

    const role = this.policy.normalizeRole(params.actor.role);
    if (role === 'USER' && request.ownerId !== params.actor.id) {
      throw new ForbiddenException('Not allowed to fulfill this request');
    }

    const evidence = await this.prisma.$queryRaw<any[]>`
      SELECT id, status
      FROM "Evidence"
      WHERE id = ${evidenceId}
      LIMIT 1
    `;
    const evidenceRow = evidence[0];
    if (!evidenceRow) throw new NotFoundException('Evidence not found');

    const existing = await this.prisma.$queryRaw<any[]>`
      SELECT id
      FROM "EvidenceRequestFulfillment"
      WHERE requestId = ${requestId} AND evidenceId = ${evidenceId}
      LIMIT 1
    `;

    let fulfillmentId = existing[0]?.id as string | undefined;
    if (!fulfillmentId) {
      fulfillmentId = randomUUID();
      await this.prisma.$executeRaw`
        INSERT INTO "EvidenceRequestFulfillment" (
          id,
          requestId,
          evidenceId,
          createdById,
          createdAt
        ) VALUES (
          ${fulfillmentId},
          ${requestId},
          ${evidenceId},
          ${params.actor.id},
          datetime('now')
        )
      `;
    }

    const nextStatus = deriveRequestStatusFromEvidence(evidenceRow.status);
    await this.prisma.$executeRaw`
      UPDATE "ControlEvidenceRequest"
      SET
        status = ${nextStatus},
        closedAt = ${nextStatus === 'CLOSED' ? new Date().toISOString() : null},
        updatedAt = datetime('now')
      WHERE id = ${requestId}
    `;

    await this.quality.recomputeEvidenceQuality({
      evidenceId,
      actor: params.actor,
      reason: 'EVIDENCE_REQUEST_FULFILLED',
      requestId: params.requestTraceId || null,
      force: true,
    });

    const after = await this.getRequestById(requestId);
    await this.audit.log({
      actorId: params.actor.id,
      actorRole: params.actor.role,
      actionType: 'EVIDENCE_REQUEST_FULFILLED',
      entityType: 'ControlEvidenceRequest',
      entityId: requestId,
      before: request,
      after,
      reason: params.reason || null,
      requestId: params.requestTraceId || null,
    });

    return {
      ok: true,
      fulfillmentId,
      request: after,
    };
  }

  async getReviewInbox(params: { user: AuthUser; bucket: 'pending' | 'expiring' | 'overdue' }) {
    const role = this.policy.normalizeRole(params.user.role);
    if (params.bucket === 'overdue') {
      const requests = await this.listRequests({
        user: params.user,
        status: 'OVERDUE',
        page: 1,
        pageSize: 100,
      });
      return {
        bucket: 'overdue',
        items: requests.items,
      };
    }

    const queryStatus = params.bucket === 'pending' ? ['SUBMITTED', 'REVIEWED'] : ['ACCEPTED'];
    const validToBoundary =
      params.bucket === 'expiring' ? new Date(Date.now() + 30 * 86400000).toISOString() : null;

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        e.id,
        e.title,
        e.type,
        e.status,
        e.validTo,
        e.qualityScore,
        e.qualityGrade,
        e.qualityFactors,
        e.qualityComputedAt,
        e.qualityVersion,
        e.createdAt,
        d.originalName AS documentName,
        c.userId AS conversationUserId
      FROM "Evidence" e
      LEFT JOIN "Document" d ON d.id = e.documentId
      LEFT JOIN "Conversation" c ON c.id = d.conversationId
      WHERE e.status IN (${queryStatus[0]}, ${queryStatus[1] || queryStatus[0]})
        AND (${validToBoundary ? 1 : 0} = 0 OR (e.validTo IS NOT NULL AND datetime(e.validTo) <= datetime(${validToBoundary})))
        AND (${role} <> 'USER' OR COALESCE(c.userId, e.createdById, '') = ${params.user.id})
      ORDER BY datetime(e.createdAt) DESC
      LIMIT 200
    `;

    return {
      bucket: params.bucket,
      items: rows.map((row) => this.normalizeEvidenceRow(row)),
    };
  }

  async backfillFromDocuments(actor?: AuthUser) {
    const documents = await this.prisma.$queryRaw<any[]>`
      SELECT
        d.id,
        d.originalName,
        d.docType,
        d.mimeType,
        d.matchStatus,
        d.matchNote,
        d.reviewedAt,
        d.submittedAt,
        d.createdAt,
        c.userId AS conversationUserId
      FROM "Document" d
      LEFT JOIN "Conversation" c ON c.id = d.conversationId
      ORDER BY datetime(d.createdAt) ASC
    `;

    let created = 0;
    let reused = 0;

    for (const doc of documents) {
      const result = await this.syncEvidenceFromDocument({
        documentId: doc.id,
        fallbackCreatedById: doc.conversationUserId || actor?.id || null,
      });
      if (result.created) created += 1;
      else reused += 1;
    }

    if (actor) {
      await this.audit.log({
        actorId: actor.id,
        actorRole: actor.role,
        actionType: 'EVIDENCE_BACKFILL_RUN',
        entityType: 'Evidence',
        entityId: 'bulk',
        before: null,
        after: { created, reused, scanned: documents.length },
      });
    }

    return { scanned: documents.length, created, reused };
  }

  async syncEvidenceFromDocument(params: { documentId: string; fallbackCreatedById?: string | null }) {
    const documentId = String(params.documentId || '').trim();
    if (!documentId) {
      throw new BadRequestException('documentId is required');
    }

    const docRows = await this.prisma.$queryRaw<any[]>`
      SELECT
        d.id,
        d.originalName,
        d.docType,
        d.mimeType,
        d.matchStatus,
        d.matchNote,
        d.reviewedAt,
        d.submittedAt,
        d.createdAt,
        c.userId AS conversationUserId
      FROM "Document" d
      LEFT JOIN "Conversation" c ON c.id = d.conversationId
      WHERE d.id = ${documentId}
      LIMIT 1
    `;
    const doc = docRows[0];
    if (!doc) throw new NotFoundException('Document not found');

    const existing = await this.prisma.$queryRaw<any[]>`
      SELECT id FROM "Evidence" WHERE documentId = ${documentId} LIMIT 1
    `;
    if (existing.length) {
      await this.prisma.$executeRaw`
        UPDATE "Evidence"
        SET
          title = ${doc.originalName || 'Document evidence'},
          type = ${doc.docType || doc.mimeType || 'document'},
          status = ${this.mapEvidenceStatusFromDocument(doc)},
          reviewComment = ${String(doc.matchNote || '').trim() || null},
          reviewedAt = ${doc.reviewedAt || null},
          updatedAt = datetime('now')
        WHERE id = ${existing[0].id}
      `;
      await this.quality.recomputeEvidenceQuality({
        evidenceId: String(existing[0].id),
        actor: null,
        reason: 'EVIDENCE_SYNC_FROM_DOCUMENT',
        force: true,
      });
      return { created: false, evidenceId: existing[0].id };
    }

    const evidenceId = randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO "Evidence" (
        id,
        title,
        type,
        source,
        documentId,
        createdById,
        status,
        reviewedAt,
        reviewComment,
        createdAt,
        updatedAt
      ) VALUES (
        ${evidenceId},
        ${doc.originalName || 'Document evidence'},
        ${doc.docType || doc.mimeType || 'document'},
        'upload',
        ${doc.id},
        ${doc.conversationUserId || params.fallbackCreatedById || null},
        ${this.mapEvidenceStatusFromDocument(doc)},
        ${doc.reviewedAt || null},
        ${String(doc.matchNote || '').trim() || null},
        ${doc.createdAt || new Date().toISOString()},
        datetime('now')
      )
    `;
    await this.quality.recomputeEvidenceQuality({
      evidenceId,
      actor: null,
      reason: 'EVIDENCE_CREATED_FROM_DOCUMENT',
      force: true,
    });
    return { created: true, evidenceId };
  }

  async deleteEvidenceByDocumentId(documentId: string) {
    await this.prisma.$executeRaw`
      DELETE FROM "Evidence"
      WHERE documentId = ${documentId}
    `;
  }

  async syncRequestsForEvidence(evidenceId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT r.id, e.status
      FROM "ControlEvidenceRequest" r
      INNER JOIN "EvidenceRequestFulfillment" f ON f.requestId = r.id
      INNER JOIN "Evidence" e ON e.id = f.evidenceId
      WHERE e.id = ${evidenceId}
    `;

    for (const row of rows) {
      const nextStatus = deriveRequestStatusFromEvidence(row.status);
      await this.prisma.$executeRaw`
        UPDATE "ControlEvidenceRequest"
        SET
          status = ${nextStatus},
          closedAt = ${nextStatus === 'CLOSED' ? new Date().toISOString() : null},
          updatedAt = datetime('now')
        WHERE id = ${row.id}
      `;
    }
  }

  private mapEvidenceStatusFromDocument(doc: any): EvidenceStatus {
    const matchStatus = String(doc.matchStatus || '').toUpperCase();
    if (matchStatus === 'COMPLIANT') return 'ACCEPTED';
    if (matchStatus === 'NOT_COMPLIANT') return 'REJECTED';
    if (doc.reviewedAt) return 'REVIEWED';
    return 'SUBMITTED';
  }

  private normalizeEvidenceRow(row: any) {
    const qualityScore =
      row.qualityScore === undefined || row.qualityScore === null
        ? null
        : Number(row.qualityScore);
    const qualityGradeRaw = String(row.qualityGrade || '').toUpperCase();
    const qualityGrade =
      qualityGradeRaw === 'STRONG' || qualityGradeRaw === 'MEDIUM' || qualityGradeRaw === 'WEAK'
        ? qualityGradeRaw
        : null;
    const qualityFactors =
      typeof row.qualityFactors === 'string'
        ? this.tryParseJson(row.qualityFactors)
        : row.qualityFactors || null;
    return {
      id: row.id,
      title: row.title || row.documentName || 'Evidence',
      type: row.type || 'document',
      source: row.source || 'upload',
      documentId: row.documentId || null,
      url: row.url || null,
      status: String(row.status || '').toUpperCase(),
      createdById: row.createdById || null,
      createdByName: row.createdByName || null,
      reviewedById: row.reviewedById || null,
      reviewedAt: row.reviewedAt || null,
      reviewComment: row.reviewComment || null,
      validFrom: row.validFrom || null,
      validTo: row.validTo || null,
      qualityScore: Number.isFinite(qualityScore) ? qualityScore : null,
      qualityGrade,
      qualityFactors,
      qualityComputedAt: row.qualityComputedAt || null,
      qualityVersion: Number(row.qualityVersion || 0) || 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt || null,
      matchControlId: row.matchControlId || null,
      linksCount: Number(row.linksCount || 0),
    };
  }

  private toRequiredDate(value: string, message: string) {
    const date = this.toNullableDate(value);
    if (!date) {
      throw new BadRequestException(message);
    }
    return date;
  }

  private toNullableDate(value?: string | null) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid date: ${raw}`);
    }
    return date;
  }

  private tryParseJson(value: string) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private async getRequestById(id: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        id,
        controlId,
        testComponentId,
        ownerId,
        dueDate,
        status,
        createdById,
        dedupKey,
        createdAt,
        updatedAt,
        closedAt
      FROM "ControlEvidenceRequest"
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] || null;
  }

  private async markOverdueRequests() {
    await this.prisma.$executeRawUnsafe(`
      UPDATE "ControlEvidenceRequest"
      SET status = 'OVERDUE', updatedAt = datetime('now')
      WHERE status IN ('OPEN', 'SUBMITTED')
        AND dueDate IS NOT NULL
        AND datetime(dueDate) < datetime('now')
    `);
  }

  private async ensureSchema() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Evidence" (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        documentId TEXT,
        url TEXT,
        createdById TEXT,
        status TEXT NOT NULL DEFAULT 'SUBMITTED',
        reviewedById TEXT,
        reviewedAt TEXT,
        reviewComment TEXT,
        validFrom TEXT,
        validTo TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Evidence_documentId_key"
      ON "Evidence"(documentId)
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Evidence_status_idx"
      ON "Evidence"(status)
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Evidence_validTo_idx"
      ON "Evidence"(validTo)
    `);
    await this.prisma.$executeRawUnsafe(`
      ALTER TABLE "Evidence" ADD COLUMN "qualityScore" INTEGER
    `).catch(() => undefined);
    await this.prisma.$executeRawUnsafe(`
      ALTER TABLE "Evidence" ADD COLUMN "qualityGrade" TEXT
    `).catch(() => undefined);
    await this.prisma.$executeRawUnsafe(`
      ALTER TABLE "Evidence" ADD COLUMN "qualityFactors" JSON
    `).catch(() => undefined);
    await this.prisma.$executeRawUnsafe(`
      ALTER TABLE "Evidence" ADD COLUMN "qualityComputedAt" DATETIME
    `).catch(() => undefined);
    await this.prisma.$executeRawUnsafe(`
      ALTER TABLE "Evidence" ADD COLUMN "qualityVersion" INTEGER NOT NULL DEFAULT 1
    `).catch(() => undefined);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Evidence_qualityGrade_idx"
      ON "Evidence"(qualityGrade)
    `).catch(() => undefined);

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "EvidenceControlLink" (
        id TEXT PRIMARY KEY,
        evidenceId TEXT NOT NULL,
        controlId TEXT NOT NULL,
        linkedById TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (evidenceId) REFERENCES "Evidence"(id) ON DELETE CASCADE,
        FOREIGN KEY (controlId) REFERENCES "ControlDefinition"(id) ON DELETE CASCADE
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceControlLink_evidence_control_key"
      ON "EvidenceControlLink"(evidenceId, controlId)
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "EvidenceControlLink_control_idx"
      ON "EvidenceControlLink"(controlId)
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ControlEvidenceRequest" (
        id TEXT PRIMARY KEY,
        controlId TEXT NOT NULL,
        testComponentId TEXT,
        ownerId TEXT NOT NULL,
        dueDate TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        createdById TEXT NOT NULL,
        dedupKey TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
        closedAt TEXT,
        FOREIGN KEY (controlId) REFERENCES "ControlDefinition"(id) ON DELETE CASCADE,
        FOREIGN KEY (testComponentId) REFERENCES "TestComponent"(id) ON DELETE SET NULL
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ControlEvidenceRequest_dedupKey_key"
      ON "ControlEvidenceRequest"(dedupKey)
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ControlEvidenceRequest_status_idx"
      ON "ControlEvidenceRequest"(status)
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ControlEvidenceRequest_owner_idx"
      ON "ControlEvidenceRequest"(ownerId)
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ControlEvidenceRequest_control_idx"
      ON "ControlEvidenceRequest"(controlId)
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "EvidenceRequestFulfillment" (
        id TEXT PRIMARY KEY,
        requestId TEXT NOT NULL,
        evidenceId TEXT NOT NULL,
        createdById TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (requestId) REFERENCES "ControlEvidenceRequest"(id) ON DELETE CASCADE,
        FOREIGN KEY (evidenceId) REFERENCES "Evidence"(id) ON DELETE CASCADE
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceRequestFulfillment_request_evidence_key"
      ON "EvidenceRequestFulfillment"(requestId, evidenceId)
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "EvidenceRequestFulfillment_request_idx"
      ON "EvidenceRequestFulfillment"(requestId)
    `);
  }

  private async ensureBootstrappedEvidence() {
    if (this.bootstrapChecked) return;
    if (this.bootstrapPromise) {
      await this.bootstrapPromise;
      return;
    }

    this.bootstrapPromise = (async () => {
      const evidenceCountRows = await this.prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(1) AS count
        FROM "Evidence"
      `;
      const evidenceCount = Number(evidenceCountRows[0]?.count || 0);
      if (evidenceCount > 0) {
        this.bootstrapChecked = true;
        return;
      }

      const documentCountRows = await this.prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(1) AS count
        FROM "Document"
      `;
      const documentCount = Number(documentCountRows[0]?.count || 0);
      if (documentCount <= 0) {
        this.bootstrapChecked = true;
        return;
      }

      await this.backfillFromDocuments();
      this.bootstrapChecked = true;
    })()
      .catch((error) => {
        console.error('[EVIDENCE] bootstrap backfill failed', error);
      })
      .finally(() => {
        this.bootstrapPromise = null;
      });

    await this.bootstrapPromise;
  }
}
