import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { PrismaModule } from '../prisma/prisma.module';
import { IngestModule } from '../ingest/ingest.module';
import { StandardsController } from './standards.controller';
import { AgentService } from '../agent/agent.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, IngestModule, AuthModule],
  controllers: [UploadController, StandardsController],
  providers: [UploadService, AgentService],
  exports: [UploadService],
})
export class UploadModule {}
