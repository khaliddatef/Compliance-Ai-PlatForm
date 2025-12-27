import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { PrismaModule } from '../prisma/prisma.module';
import { IngestModule } from '../ingest/ingest.module';
import { StandardsController } from './standards.controller';

@Module({
  imports: [PrismaModule, IngestModule],
  controllers: [UploadController, StandardsController],
  providers: [UploadService],
})
export class UploadModule {}
