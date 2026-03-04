import { Module } from '@nestjs/common';
import { AuditPackService } from './audit-pack.service';
import { AuditPackController } from './audit-pack.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [AuditPackService],
  controllers: [AuditPackController],
  exports: [AuditPackService],
})
export class AuditPackModule {}

