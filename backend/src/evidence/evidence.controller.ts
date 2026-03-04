import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.service';
import { PolicyGuard } from '../access-control/policy.guard';
import { RequireRoles } from '../access-control/policy.decorator';
import { EvidenceService } from './evidence.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { IdempotencyService } from '../idempotency/idempotency.service';

@Controller('api/evidence')
@UseGuards(AuthGuard, PolicyGuard)
export class EvidenceController {
  constructor(
    private readonly evidence: EvidenceService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @RequireRoles('ADMIN', 'MANAGER', 'USER')
  async listEvidence(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    this.assertEnabled();
    return this.evidence.listEvidence({
      user,
      status,
      q,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('review/inbox')
  @RequireRoles('ADMIN', 'MANAGER', 'USER')
  async reviewInbox(
    @CurrentUser() user: AuthUser,
    @Query('bucket') bucket?: 'pending' | 'expiring' | 'overdue',
  ) {
    this.assertEnabled();
    const normalized = (bucket || 'pending').toLowerCase();
    const allowed = new Set(['pending', 'expiring', 'overdue']);
    const safeBucket = allowed.has(normalized) ? (normalized as 'pending' | 'expiring' | 'overdue') : 'pending';
    const payload = await this.evidence.getReviewInbox({ user, bucket: safeBucket });
    return { ok: true, ...payload };
  }

  @Get('by-document/:documentId')
  @RequireRoles('ADMIN', 'MANAGER', 'USER')
  async getEvidenceByDocumentId(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
  ) {
    this.assertEnabled();
    const evidence = await this.evidence.getEvidenceByDocumentId(documentId, user);
    return { ok: true, evidence };
  }

  @Get(':id')
  @RequireRoles('ADMIN', 'MANAGER', 'USER')
  async getEvidence(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertEnabled();
    const evidence = await this.evidence.getEvidenceById(id, user);
    return { ok: true, evidence };
  }

  @Get(':id/quality')
  @RequireRoles('ADMIN', 'MANAGER', 'USER')
  async getEvidenceQuality(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('controlId') controlId?: string,
    @Query('testComponentId') testComponentId?: string,
  ) {
    this.assertEnabled();
    this.assertQualityEnabled();
    const quality = await this.evidence.getEvidenceQuality({
      evidenceId: id,
      user,
      controlId: controlId || null,
      testComponentId: testComponentId || null,
    });
    return { ok: true, quality };
  }

  @Post(':id/quality/recompute')
  @RequireRoles('ADMIN', 'MANAGER')
  async recomputeEvidenceQuality(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-request-id') requestId?: string,
    @Body()
    body?: {
      reason?: string;
      force?: boolean;
    },
  ) {
    this.assertEnabled();
    this.assertQualityEnabled();

    const payload = {
      evidenceId: id,
      reason: String(body?.reason || '').trim() || null,
      force: body?.force === true,
    };

    if (String(idempotencyKey || '').trim()) {
      const result = await this.idempotency.execute({
        key: String(idempotencyKey || ''),
        actorId: user.id,
        actionType: 'EVIDENCE_QUALITY_RECOMPUTE',
        payload,
        handler: async () =>
          this.evidence.recomputeEvidenceQuality({
            evidenceId: id,
            actor: user,
            reason: payload.reason,
            requestId: requestId || null,
            force: payload.force,
          }),
      });
      return {
        ok: true,
        replayed: result.replayed,
        quality: result.value,
      };
    }

    const quality = await this.evidence.recomputeEvidenceQuality({
      evidenceId: id,
      actor: user,
      reason: payload.reason,
      requestId: requestId || null,
      force: payload.force,
    });
    return { ok: true, replayed: false, quality };
  }

  @Patch(':id/review')
  @RequireRoles('ADMIN', 'MANAGER')
  async reviewEvidence(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('x-request-id') requestId?: string,
    @Body()
    body?: {
      status?: string;
      reviewComment?: string;
      validFrom?: string;
      validTo?: string;
      reason?: string;
    },
  ) {
    this.assertEnabled();
    const evidence = await this.evidence.reviewEvidence({
      evidenceId: id,
      actor: user,
      status: String(body?.status || ''),
      reviewComment: body?.reviewComment || null,
      validFrom: body?.validFrom || null,
      validTo: body?.validTo || null,
      reason: body?.reason || null,
      requestId: requestId || null,
    });
    return { ok: true, evidence };
  }

  @Post('links')
  @RequireRoles('ADMIN', 'MANAGER')
  async linkEvidence(
    @CurrentUser() user: AuthUser,
    @Headers('x-request-id') requestId?: string,
    @Body()
    body?: {
      evidenceId?: string;
      controlId?: string;
      reason?: string;
    },
  ) {
    this.assertEnabled();
    const result = await this.evidence.linkEvidenceToControl({
      evidenceId: String(body?.evidenceId || ''),
      controlId: String(body?.controlId || ''),
      actor: user,
      reason: body?.reason || null,
      requestId: requestId || null,
    });
    return { ok: true, ...result };
  }

  @Delete('links/:linkId')
  @RequireRoles('ADMIN', 'MANAGER')
  async deleteEvidenceLink(
    @CurrentUser() user: AuthUser,
    @Headers('x-request-id') requestId: string | undefined,
    @Param('linkId') linkId: string,
    @Body() body?: { reason?: string },
  ) {
    this.assertEnabled();
    const result = await this.evidence.deleteEvidenceLink({
      linkId,
      actor: user,
      reason: body?.reason || null,
      requestId: requestId || null,
    });
    return { ...result };
  }

  @Post('backfill')
  @RequireRoles('ADMIN', 'MANAGER')
  async backfill(@CurrentUser() user: AuthUser) {
    this.assertEnabled();
    const result = await this.evidence.backfillFromDocuments(user);
    return { ok: true, ...result };
  }

  private assertEnabled() {
    if (!this.featureFlags.isEnabled('evidenceV2')) {
      throw new NotFoundException('Evidence V2 is disabled');
    }
  }

  private assertQualityEnabled() {
    if (!this.featureFlags.isEnabled('evidenceQualityV1')) {
      throw new NotFoundException('Evidence quality scoring is disabled');
    }
  }
}
