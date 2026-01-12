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
  async getDashboard(@Query('standard') standard?: string, @CurrentUser() user?: AuthUser) {
    if (user?.role === 'USER') {
      throw new ForbiddenException('Dashboard access is restricted');
    }
    return this.dashboard.getDashboard(standard);
  }
}
