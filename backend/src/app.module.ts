import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { ChatModule } from './chat/chat.module';
import { HealthModule } from './health/health.module';
import { UploadModule } from './upload/upload.module';
import { PrismaModule } from './prisma/prisma.module';
import { IngestModule } from './ingest/ingest.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ControlKbModule } from './control-kb/control-kb.module';
import { SettingsModule } from './settings/settings.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { AccessControlModule } from './access-control/access-control.module';
import { AuditModule } from './audit/audit.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { EvidenceModule } from './evidence/evidence.module';
import { CopilotModule } from './copilot/copilot.module';
import { AuditPackModule } from './audit-pack/audit-pack.module';
import { ConnectorsModule } from './connectors/connectors.module';

const runtimeRoot = path.resolve(__dirname, '..');
const envFilePath =
  path.basename(runtimeRoot).toLowerCase() === 'dist'
    ? path.resolve(runtimeRoot, '..', '.env')
    : path.resolve(runtimeRoot, '.env');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [envFilePath, '.env'],
    }),
    FeatureFlagsModule,
    AccessControlModule,
    AuditModule,
    IdempotencyModule,
    PrismaModule,
    HealthModule,
    ChatModule,
    UploadModule,
    IngestModule,
    AuthModule,
    DashboardModule,
    ControlKbModule,
    SettingsModule,
    EvidenceModule,
    CopilotModule,
    AuditPackModule,
    ConnectorsModule,
  ],
  providers: [Logger],
})
export class AppModule {}
