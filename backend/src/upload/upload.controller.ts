import {
  Body,
  Controller,
  Delete,
  GoneException,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { UploadService } from './upload.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.service';
import {
  CUSTOMER_ALLOWED_EXTENSIONS,
  CUSTOMER_ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  makeFileFilter,
} from './upload.validation';

type DocKind = 'CUSTOMER' | 'STANDARD';

@Controller('api/uploads')
@UseGuards(AuthGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  // ✅ LIST (حل 404)
  @Get()
  async list(
    @Query('conversationId') conversationId: string,
    @Query('kind') kind?: DocKind,
    @Query('all') all?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    const { name: activeFramework, version: activeFrameworkVersion } =
      await this.uploadService.getActiveFrameworkInfo();
    const allRequested = String(all || '').toLowerCase();
    if (allRequested === 'true' || allRequested === '1') {
      const docs = await this.uploadService.listAllForUser(user);
      return { ok: true, documents: docs, activeFramework, activeFrameworkVersion };
    }

    if (!conversationId) return { ok: false, message: 'conversationId is required' };

    const docs = await this.uploadService.listByConversation({
      conversationId,
      kind,
      user,
    });

    return { ok: true, conversationId, documents: docs, activeFramework, activeFrameworkVersion };
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const doc = await this.uploadService.getDocumentDetails(id);
    if (!doc) throw new NotFoundException('Document not found');
    this.assertDocAccess(doc, user);
    return { ok: true, document: doc };
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response, @CurrentUser() user: AuthUser) {
    const doc = await this.uploadService.getDocumentWithOwner(id);
    if (!doc) throw new NotFoundException('Document not found');
    this.assertDocAccess(doc, user);

    const resolvedPath = path.isAbsolute(doc.storagePath)
      ? doc.storagePath
      : path.resolve(process.cwd(), doc.storagePath);

    try {
      await fs.stat(resolvedPath);
    } catch {
      throw new NotFoundException('File not found on disk');
    }

    const safeName = (doc.originalName || 'document')
      .replace(/[^\w.\-]+/g, '_')
      .slice(0, 120);

    return res.download(resolvedPath, safeName);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const doc = await this.uploadService.getDocumentWithOwner(id);
    if (!doc) throw new NotFoundException('Document not found');
    this.assertDocAccess(doc, user);

    const deleted = await this.uploadService.deleteDocument(id);
    if (!deleted) throw new NotFoundException('Document not found');
    return { ok: true };
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status?: 'REVIEWED' | 'SUBMITTED' },
    @CurrentUser() user: AuthUser,
  ) {
    if (user.role === 'USER') {
      throw new ForbiddenException('Not allowed to update file status');
    }

    const status = String(body?.status || '').toUpperCase();
    if (status !== 'REVIEWED' && status !== 'SUBMITTED') {
      throw new ForbiddenException('Invalid status');
    }

    const updated = await this.uploadService.updateDocumentStatus(id, status as 'REVIEWED' | 'SUBMITTED');
    if (!updated) throw new NotFoundException('Document not found');
    return { ok: true, document: updated };
  }

  @Patch(':id/match-status')
  async updateMatchStatus(
    @Param('id') id: string,
    @Body() body: { matchStatus?: 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN' },
    @CurrentUser() user: AuthUser,
  ) {
    if (user.role === 'USER') {
      throw new ForbiddenException('Not allowed to update file compliance status');
    }

    const matchStatus = String(body?.matchStatus || '').toUpperCase();
    const allowed = ['COMPLIANT', 'PARTIAL', 'NOT_COMPLIANT', 'UNKNOWN'];
    if (!allowed.includes(matchStatus)) {
      throw new ForbiddenException('Invalid match status');
    }

    const updated = await this.uploadService.updateDocumentMatchStatus(
      id,
      matchStatus as 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN',
    );
    if (!updated) throw new NotFoundException('Document not found');
    return { ok: true, document: updated };
  }

  @Post(':id/reevaluate')
  async reevaluate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('language') language?: 'ar' | 'en',
  ) {
    const doc = await this.uploadService.getDocumentWithOwner(id);
    if (!doc) throw new NotFoundException('Document not found');
    this.assertDocAccess(doc, user);

    const updated = await this.uploadService.reevaluateDocument(id, language);
    if (!updated) throw new NotFoundException('Document not found');
    return { ok: true, document: updated };
  }

  @Post('submit')
  async submitEvidence(
    @Body()
    body: {
      documentIds?: string[];
      controlId?: string;
      status?: 'COMPLIANT' | 'PARTIAL';
      note?: string;
    },
    @CurrentUser() user: AuthUser,
  ) {
    const documentIds = Array.isArray(body?.documentIds) ? body.documentIds : [];
    const allowed = await this.uploadService.ensureDocsAccess(documentIds, user);
    if (!allowed) {
      throw new ForbiddenException('Not allowed to submit these documents');
    }

    return this.uploadService.submitEvidence({
      documentIds,
      controlId: String(body?.controlId || ''),
      status: String(body?.status || '').toUpperCase() as 'COMPLIANT' | 'PARTIAL',
      note: body?.note,
    });
  }

  // ✅ UPLOAD
  @Post()
  @UseInterceptors(
    FilesInterceptor('files', MAX_UPLOAD_FILES, {
      storage: diskStorage({
        destination: './uploads',
        filename: (_, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${path.extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES },
      fileFilter: makeFileFilter(CUSTOMER_ALLOWED_MIME_TYPES, CUSTOMER_ALLOWED_EXTENSIONS),
    }),
  )
  async upload(
    @Query('conversationId') conversationId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: AuthUser,
    @Query('kind') kind: DocKind = 'CUSTOMER',
    @Query('language') language?: 'ar' | 'en',
  ) {
    if (kind === 'STANDARD') {
      throw new GoneException('Standard uploads are disabled. Use the KB instead.');
    }

    return this.uploadService.saveUploadedFiles({
      conversationId,
      kind,
      files,
      user,
      language,
    });
  }

  private assertDocAccess(doc: { conversation?: { userId?: string | null } }, user: AuthUser) {
    if (user.role !== 'USER') return;
    const ownerId = doc.conversation?.userId;
    if (!ownerId || ownerId !== user.id) {
      throw new ForbiddenException('Not allowed to access this file');
    }
  }
}
