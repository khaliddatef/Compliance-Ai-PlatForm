import { Module } from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import { EvidenceController } from './evidence.controller';
import { EvidenceRequestsController } from './evidence-requests.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EvidenceQualityService } from './evidence-quality.service';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [EvidenceService, EvidenceQualityService],
  controllers: [EvidenceController, EvidenceRequestsController],
  exports: [EvidenceService, EvidenceQualityService],
})
export class EvidenceModule {}
