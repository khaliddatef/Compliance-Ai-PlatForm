import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PolicyGuard } from '../access-control/policy.guard';
import { RequireRoles } from '../access-control/policy.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.service';
import { ConnectorsService } from './connectors.service';

@Controller('api/connectors')
@UseGuards(AuthGuard, PolicyGuard)
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get()
  @RequireRoles('ADMIN', 'MANAGER')
  async listConnectors() {
    const connectors = await this.connectors.listConnectors();
    return { ok: true, connectors };
  }

  @Post()
  @RequireRoles('ADMIN', 'MANAGER')
  async createConnector(
    @CurrentUser() user: AuthUser,
    @Body()
    body?: {
      name?: string;
      type?: string;
      config?: unknown;
    },
  ) {
    const connector = await this.connectors.createConnector({
      actor: user,
      name: String(body?.name || ''),
      type: String(body?.type || ''),
      config: body?.config,
    });
    return { ok: true, connector };
  }

  @Post(':id/runs')
  @RequireRoles('ADMIN', 'MANAGER')
  async runConnector(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body?: {
      artifacts?: Array<{
        type?: string;
        source?: string;
        timestamp?: string;
        rawPayloadRef?: string;
        parsedSummary?: unknown;
      }>;
    },
  ) {
    const run = await this.connectors.runConnector({
      actor: user,
      connectorId: id,
      artifacts: body?.artifacts,
    });
    return { ok: true, run };
  }

  @Get(':id/artifacts')
  @RequireRoles('ADMIN', 'MANAGER')
  async listArtifacts(@Param('id') id: string) {
    const artifacts = await this.connectors.listArtifacts(id);
    return { ok: true, artifacts };
  }

  @Post('artifacts/:artifactId/convert-to-evidence')
  @RequireRoles('ADMIN', 'MANAGER')
  async convertArtifactToEvidence(
    @CurrentUser() user: AuthUser,
    @Param('artifactId') artifactId: string,
    @Body() body?: { controlId?: string },
  ) {
    const result = await this.connectors.convertArtifactToEvidence({
      actor: user,
      artifactId,
      controlId: String(body?.controlId || '').trim() || undefined,
    });
    return { ok: true, ...result };
  }
}

