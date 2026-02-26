import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthGuard } from '../auth/auth.guard';
import type { AiSettings, NotificationSettings } from './settings.service';
import { SettingsService } from './settings.service';

@UseGuards(AuthGuard)
@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('me')
  async getMySettings(@CurrentUser() user: AuthUser) {
    const data = await this.settings.getMySettings(user);
    return {
      ok: true,
      user,
      ...data,
    };
  }

  @Patch('notifications')
  async updateNotifications(
    @CurrentUser() user: AuthUser,
    @Body() body: Partial<NotificationSettings>,
  ) {
    const notifications = await this.settings.updateNotifications(user, body || {});
    return { ok: true, notifications };
  }

  @Patch('ai')
  async updateAiSettings(
    @CurrentUser() user: AuthUser,
    @Body() body: Partial<AiSettings>,
  ) {
    const ai = await this.settings.updateAiSettings(user, body || {});
    return { ok: true, ai };
  }

  @Get('team')
  async listTeamAccess(@CurrentUser() user: AuthUser) {
    const team = await this.settings.listTeamAccess(user);
    return { ok: true, ...team };
  }

  @Post('team/invite')
  async createInvite(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      email?: string;
      name?: string;
      role?: 'ADMIN' | 'MANAGER' | 'USER';
      message?: string;
    },
  ) {
    const invite = await this.settings.createTeamInvite(user, body || {});
    return { ok: true, invite };
  }

  @Patch('team/invites/:id/cancel')
  async cancelInvite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.settings.cancelTeamInvite(user, id);
  }

  @Patch('team/:userId/role')
  async updateTeamRole(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() body: { role?: 'ADMIN' | 'MANAGER' | 'USER' },
  ) {
    const member = await this.settings.updateTeamMemberRole(user, userId, body || {});
    return { ok: true, member };
  }
}
