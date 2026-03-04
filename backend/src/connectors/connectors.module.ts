import { Module } from '@nestjs/common';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EvidenceModule } from '../evidence/evidence.module';

@Module({
  imports: [PrismaModule, AuthModule, EvidenceModule],
  controllers: [ConnectorsController],
  providers: [ConnectorsService],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}

