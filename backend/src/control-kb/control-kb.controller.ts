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
  async listTopics(@CurrentUser() user: AuthUser, @Query('standard') standard = 'ISO') {
    this.assertAdmin(user);
    return this.service.listTopics(standard.toUpperCase());
  }

  @Get('catalog')
  async listCatalog(@Query('standard') standard = 'ISO') {
    return this.service.listControlCatalog(standard.toUpperCase());
  }

  @Get('context')
  async getControlContext(
    @Query('standard') standard = 'ISO',
    @Query('controlCode') controlCode?: string,
    @Query('controlId') controlId?: string,
  ) {
    const code = (controlCode || controlId || '').trim();
    if (!code) {
      throw new BadRequestException('controlCode is required');
    }
    return this.service.getControlContextByCode({ controlCode: code, standard: standard.toUpperCase() });
  }

  @Post('topics')
  async createTopic(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      standard: string;
      title: string;
      description?: string;
      mode?: string;
      status?: string;
      priority?: number;
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
    @Query('standard') standard = 'ISO',
    @Query('topicId') topicId?: string,
    @Query('q') query?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '10',
  ) {
    this.assertAdmin(user);
    return this.service.listControls({
      standard: standard.toUpperCase(),
      topicId: topicId || null,
      query: query || null,
      page: Number.parseInt(String(page), 10) || 1,
      pageSize: Number.parseInt(String(pageSize), 10) || 10,
    });
  }

  @Get('controls/:id')
  async getControl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertAdmin(user);
    return this.service.getControl(id);
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
}
