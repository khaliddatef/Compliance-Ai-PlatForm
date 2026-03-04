import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PolicyGuard } from '../access-control/policy.guard';
import { RequireRoles } from '../access-control/policy.decorator';
import { AuditService } from './audit.service';

@Controller('api/audit')
@UseGuards(AuthGuard, PolicyGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('events')
  @RequireRoles('ADMIN', 'MANAGER')
  async listEvents(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('actorId') actorId?: string,
    @Query('actionType') actionType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const events = await this.audit.list({
      entityType: entityType?.trim() || undefined,
      entityId: entityId?.trim() || undefined,
      actorId: actorId?.trim() || undefined,
      actionType: actionType?.trim() || undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { ok: true, events };
  }
}

