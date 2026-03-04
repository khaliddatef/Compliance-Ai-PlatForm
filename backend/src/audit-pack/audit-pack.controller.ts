import { Body, Controller, Get, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PolicyGuard } from '../access-control/policy.guard';
import { RequireRoles } from '../access-control/policy.decorator';
import type { AuthUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuditPackService } from './audit-pack.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

@Controller('api/audit-packs')
@UseGuards(AuthGuard, PolicyGuard)
export class AuditPackController {
  constructor(
    private readonly auditPack: AuditPackService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  @Post('generate')
  @RequireRoles('ADMIN', 'MANAGER')
  async generatePack(
    @CurrentUser() user: AuthUser,
    @Body()
    body?: {
      frameworkId?: string;
      periodStart?: string;
      periodEnd?: string;
    },
  ) {
    this.assertEnabled();
    const pack = await this.auditPack.generatePack({
      actor: user,
      input: {
        frameworkId: body?.frameworkId || null,
        periodStart: String(body?.periodStart || ''),
        periodEnd: String(body?.periodEnd || ''),
      },
    });
    return { ok: true, pack };
  }

  @Get(':id')
  @RequireRoles('ADMIN', 'MANAGER')
  async getPack(@Param('id') id: string) {
    this.assertEnabled();
    const pack = await this.auditPack.getPack(id);
    return { ok: true, pack };
  }

  @Get(':id/download')
  @RequireRoles('ADMIN', 'MANAGER')
  async downloadPack(
    @Param('id') id: string,
    @Query('format') format: 'csv' | 'zip' = 'csv',
    @Res() res: Response,
  ) {
    this.assertEnabled();
    if (String(format || '').toLowerCase() === 'zip') {
      const zip = await this.auditPack.buildZip(id);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zip.filename}"`);
      return res.send(zip.content);
    }

    const csv = await this.auditPack.buildCsv(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csv.filename}"`);
    return res.send(csv.content);
  }

  private assertEnabled() {
    if (!this.featureFlags.isEnabled('auditPackV1')) {
      throw new NotFoundException('Audit Pack V1 is disabled');
    }
  }
}
