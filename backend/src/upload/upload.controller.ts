import {
  Controller,
  Get,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';

type DocKind = 'CUSTOMER' | 'STANDARD';

@Controller('api/uploads')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  // ✅ LIST (حل 404)
  @Get()
  async list(
    @Query('conversationId') conversationId: string,
    @Query('standard') standard?: string,
    @Query('kind') kind?: DocKind,
  ) {
    if (!conversationId) return { ok: false, message: 'conversationId is required' };

    const docs = await this.uploadService.listByConversation({
      conversationId,
      standard,
      kind,
    });

    return { ok: true, conversationId, documents: docs };
  }

  // ✅ UPLOAD
  @Post()
  @UseInterceptors(FilesInterceptor('files'))
  async upload(
    @Query('conversationId') conversationId: string,
    @Query('standard') standard: string,
    @Query('kind') kind: DocKind = 'CUSTOMER',
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.uploadService.saveUploadedFiles({
      conversationId,
      standard,
      kind,
      files,
    });
  }
}
