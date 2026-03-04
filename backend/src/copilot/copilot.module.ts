import { Module } from '@nestjs/common';
import { CopilotService } from './copilot.service';
import { CopilotController } from './copilot.controller';
import { AuthModule } from '../auth/auth.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AuthModule, EvidenceModule, PrismaModule],
  providers: [CopilotService],
  controllers: [CopilotController],
  exports: [CopilotService],
})
export class CopilotModule {}

