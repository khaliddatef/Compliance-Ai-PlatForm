import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { UploadService } from '../upload/upload.service';

@Controller('api/standards')
export class StandardsController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: './uploads',
        filename: (_, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(new BadRequestException('Only PDF files allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadStandard(
    @Query('standard') standard: 'ISO' | 'FRA' | 'CBE',
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!standard) throw new BadRequestException('Missing standard query param');
    if (!files?.length) throw new BadRequestException('No files uploaded');

    // conversation ثابت لكل standard
    const conversationId = `standards-${standard}`;

    return this.uploadService.saveUploadedFiles({
      conversationId,
      standard,
      kind: 'STANDARD',
      files,
    });
  }
}
