import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ControlKbService } from './control-kb.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.service';

@UseGuards(AuthGuard)
@Controller('api/control-kb')
export class ControlKbController {
  constructor(private readonly service: ControlKbService) {}

  @Get('topics')
  async listTopics(
    @CurrentUser() user: AuthUser,
    @Query('framework') framework?: string,
  ) {
    this.assertViewAccess(user);
    return this.service.listTopics(framework?.trim() || null, user?.role === 'ADMIN');
  }

  @Get('frameworks')
  async listFrameworks(@CurrentUser() user: AuthUser) {
    this.assertViewAccess(user);
    const includeDisabled = user?.role === 'ADMIN';
    return this.service.listFrameworks(includeDisabled);
  }

  @Post('frameworks')
  async createFramework(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      name: string;
      status?: string;
    },
  ) {
    this.assertAdmin(user);
    return this.service.createFramework({
      name: body.name.trim(),
      status: body.status,
    });
  }

  @Patch('frameworks/:id')
  async updateFramework(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      status?: string;
    },
  ) {
    this.assertAdmin(user);
    return this.service.updateFramework(id, body);
  }

  @Delete('frameworks/:id')
  async deleteFramework(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertAdmin(user);
    await this.service.deleteFramework(id);
    return { ok: true };
  }

  @Get('catalog')
  async listCatalog(@CurrentUser() user: AuthUser) {
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }
    return this.service.listControlCatalog();
  }

  @Get('context')
  async getControlContext(
    @CurrentUser() user: AuthUser,
    @Query('controlCode') controlCode?: string,
    @Query('controlId') controlId?: string,
  ) {
    const code = (controlCode || controlId || '').trim();
    if (!code) {
      throw new BadRequestException('controlCode is required');
    }
    return this.service.getControlContextByCode({
      controlCode: code,
      includeDisabled: user?.role === 'ADMIN',
    });
  }

  @Post('topics')
  async createTopic(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      title: string;
      description?: string;
      mode?: string;
      status?: string;
      priority?: number;
      framework?: string;
    },
  ) {
    this.assertAdmin(user);
    return this.service.createTopic(body);
  }

  @Patch('topics/:id')
  async updateTopic(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      description?: string;
      mode?: string;
      status?: string;
      priority?: number;
    },
  ) {
    this.assertAdmin(user);
    return this.service.updateTopic(id, body);
  }

  @Delete('topics/:id')
  async deleteTopic(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertAdmin(user);
    return this.service.deleteTopic(id);
  }

  @Get('controls')
  async listControls(
    @CurrentUser() user: AuthUser,
    @Query('topicId') topicId?: string,
    @Query('q') query?: string,
    @Query('status') status?: string,
    @Query('compliance') compliance?: string,
    @Query('ownerRole') ownerRole?: string,
    @Query('evidenceType') evidenceType?: string,
    @Query('isoMapping') isoMapping?: string,
    @Query('framework') framework?: string,
    @Query('frameworkRef') frameworkRef?: string,
    @Query('gap') gap?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '10',
  ) {
    this.assertViewAccess(user);
    return this.service.listControls({
      topicId: topicId || null,
      query: query || null,
      status: status || null,
      complianceStatus: compliance || null,
      ownerRole: ownerRole || null,
      evidenceType: evidenceType || null,
      isoMapping: isoMapping || null,
      framework: framework || null,
      frameworkRef: frameworkRef || null,
      gap: gap || null,
      page: Number.parseInt(String(page), 10) || 1,
      pageSize: Number.parseInt(String(pageSize), 10) || 10,
      includeDisabled: user?.role === 'ADMIN',
    });
  }

  @Get('controls/:id')
  async getControl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertViewAccess(user);
    return this.service.getControl(id, true);
  }

  @Post('controls')
  async createControl(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      topicId: string;
      controlCode: string;
      title: string;
      description?: string;
      isoMappings?: string[];
      ownerRole?: string;
      status?: string;
      sortOrder?: number;
      framework?: string;
    },
  ) {
    this.assertAdmin(user);
    return this.service.createControl(body);
  }

  @Patch('controls/:id')
  async updateControl(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      topicId?: string;
      controlCode?: string;
      title?: string;
      description?: string;
      isoMappings?: string[];
      ownerRole?: string;
      status?: string;
      sortOrder?: number;
    },
  ) {
    this.assertAdmin(user);
    return this.service.updateControl(id, body);
  }

  @Patch('controls/:id/activation')
  async updateControlActivation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      status?: string;
    },
  ) {
    this.assertViewAccess(user);
    const status = String(body.status || '').toLowerCase();
    if (status !== 'enabled' && status !== 'disabled') {
      throw new BadRequestException('status must be enabled or disabled');
    }
    return this.service.updateControlActivation(id, status);
  }

  @Post('controls/:id/assign')
  async assignControlToFramework(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      framework?: string;
      frameworkCode?: string;
      topicId?: string;
    },
  ) {
    this.assertAdmin(user);
    const framework = String(body.framework || '').trim();
    const frameworkCode = String(body.frameworkCode || '').trim();
    const topicId = String(body.topicId || '').trim() || null;

    if (!framework || !frameworkCode) {
      throw new BadRequestException('framework and frameworkCode are required');
    }

    return this.service.assignControlToFramework({
      controlId: id,
      framework,
      frameworkCode,
      topicId,
    });
  }

  @Post('controls/:id/topics')
  async addControlTopicMapping(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      topicId: string;
      relationshipType?: 'PRIMARY' | 'RELATED';
    },
  ) {
    this.assertAdmin(user);
    const type = (body.relationshipType || 'RELATED').toUpperCase() as 'PRIMARY' | 'RELATED';
    return this.service.addControlTopicMapping(id, body.topicId, type);
  }

  @Delete('controls/:id/topics/:topicId')
  async removeControlTopicMapping(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('topicId') topicId: string,
  ) {
    this.assertAdmin(user);
    return this.service.removeControlTopicMapping(id, topicId);
  }

  @Delete('controls/:id')
  async deleteControl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertAdmin(user);
    return this.service.deleteControl(id);
  }

  @Post('controls/:id/test-components')
  async createTestComponent(
    @CurrentUser() user: AuthUser,
    @Param('id') controlId: string,
    @Body()
    body: {
      requirement: string;
      evidenceTypes?: unknown;
      acceptanceCriteria?: string;
      partialCriteria?: string;
      rejectCriteria?: string;
      sortOrder?: number;
    },
  ) {
    this.assertAdmin(user);
    return this.service.createTestComponent(controlId, body);
  }

  @Patch('test-components/:id')
  async updateTestComponent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      requirement?: string;
      evidenceTypes?: unknown;
      acceptanceCriteria?: string;
      partialCriteria?: string;
      rejectCriteria?: string;
      sortOrder?: number;
    },
  ) {
    this.assertAdmin(user);
    return this.service.updateTestComponent(id, body);
  }

  @Delete('test-components/:id')
  async deleteTestComponent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertAdmin(user);
    return this.service.deleteTestComponent(id);
  }

  private assertAdmin(user?: AuthUser) {
    if (!user || user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }
  }

  private assertViewAccess(user?: AuthUser) {
    if (!user || (user.role !== 'ADMIN' && user.role !== 'MANAGER')) {
      throw new ForbiddenException('Admin or Manager access required');
    }
  }
}
