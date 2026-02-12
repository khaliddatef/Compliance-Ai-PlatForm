import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.service';

@Controller('api/dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  async getDashboard(
    @CurrentUser() user?: AuthUser,
    @Query('businessUnit') businessUnit?: string,
    @Query('riskCategory') riskCategory?: string,
    @Query('rangeDays') rangeDays?: string,
  ) {
    if (user?.role === 'USER') {
      throw new ForbiddenException('Dashboard access is restricted');
    }
    return this.dashboard.getDashboard({
      businessUnit: businessUnit?.trim() || null,
      riskCategory: riskCategory?.trim() || null,
      rangeDays: rangeDays ? Number(rangeDays) : undefined,
    });
  }
}
