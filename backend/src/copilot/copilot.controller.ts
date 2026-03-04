import { Body, Controller, Headers, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PolicyGuard } from '../access-control/policy.guard';
import { RequireRoles } from '../access-control/policy.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.service';
import { CopilotActionType, CopilotService } from './copilot.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

@Controller('api/copilot/actions')
@UseGuards(AuthGuard, PolicyGuard)
export class CopilotController {
  constructor(
    private readonly copilot: CopilotService,
    private readonly idempotency: IdempotencyService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  @Post('execute')
  @RequireRoles('ADMIN', 'MANAGER')
  async executeAction(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-request-id') requestId?: string,
    @Body()
    body?: {
      actionType?: CopilotActionType;
      payload?: any;
      dryRun?: boolean;
    },
  ) {
    if (!this.featureFlags.isEnabled('copilotStructured')) {
      throw new NotFoundException('Copilot structured actions are disabled');
    }

    const key = this.idempotency.assertKey(idempotencyKey);
    const actionType = String(body?.actionType || '').trim().toUpperCase() as CopilotActionType;
    const payload = body?.payload || {};
    const dryRun = Boolean(body?.dryRun);

    const result = await this.idempotency.execute({
      key,
      actorId: user.id,
      actionType: `COPILOT_${actionType}${dryRun ? '_DRY_RUN' : ''}`,
      payload: { actionType, payload, dryRun },
      handler: async () =>
        this.copilot.executeAction({
          actor: user,
          actionType,
          payload,
          dryRun,
          requestId: requestId || null,
        }),
    });

    return {
      ok: true,
      replayed: result.replayed,
      action: result.value,
    };
  }
}
