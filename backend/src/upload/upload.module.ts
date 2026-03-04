import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { PrismaModule } from '../prisma/prisma.module';
import { IngestModule } from '../ingest/ingest.module';
import { AgentService } from '../agent/agent.service';
import { AuthModule } from '../auth/auth.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { DocumentInsightsService } from './document-insights.service';

@Module({
  imports: [PrismaModule, IngestModule, AuthModule, EvidenceModule],
  controllers: [UploadController],
  providers: [UploadService, AgentService, DocumentInsightsService],
  exports: [UploadService],
})
export class UploadModule {}
