import { Body, Controller, Get, Headers, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PolicyGuard } from '../access-control/policy.guard';
import { RequireRoles } from '../access-control/policy.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.service';
import { EvidenceService } from './evidence.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

@Controller('api/evidence-requests')
@UseGuards(AuthGuard, PolicyGuard)
export class EvidenceRequestsController {
  constructor(
    private readonly evidence: EvidenceService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  @Get()
  @RequireRoles('ADMIN', 'MANAGER', 'USER')
  async listRequests(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('ownerId') ownerId?: string,
    @Query('controlId') controlId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    this.assertEnabled();
    return this.evidence.listRequests({
      user,
      status,
      ownerId,
      controlId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post()
  @RequireRoles('ADMIN', 'MANAGER')
  async createRequest(
    @CurrentUser() user: AuthUser,
    @Headers('x-request-id') requestId?: string,
    @Body()
    body?: {
      controlId?: string;
      testComponentId?: string;
      ownerId?: string;
      dueDate?: string;
      dedupKey?: string;
      reason?: string;
    },
  ) {
    this.assertEnabled();
    const result = await this.evidence.createRequest({
      actor: user,
      input: {
        controlId: String(body?.controlId || ''),
        testComponentId: body?.testComponentId || null,
        ownerId: String(body?.ownerId || ''),
        dueDate: String(body?.dueDate || ''),
        dedupKey: body?.dedupKey || null,
      },
      reason: body?.reason || null,
      requestId: requestId || null,
    });
    return { ok: true, ...result };
  }

  @Post(':id/fulfill')
  @RequireRoles('ADMIN', 'MANAGER', 'USER')
  async fulfillRequest(
    @CurrentUser() user: AuthUser,
    @Headers('x-request-id') requestId?: string,
    @Param('id') id?: string,
    @Body()
    body?: {
      evidenceId?: string;
      reason?: string;
    },
  ) {
    this.assertEnabled();
    const result = await this.evidence.fulfillRequest({
      requestId: String(id || ''),
      evidenceId: String(body?.evidenceId || ''),
      actor: user,
      reason: body?.reason || null,
      requestTraceId: requestId || null,
    });
    return result;
  }

  private assertEnabled() {
    if (!this.featureFlags.isEnabled('evidenceV2')) {
      throw new NotFoundException('Evidence V2 is disabled');
    }
  }
}
