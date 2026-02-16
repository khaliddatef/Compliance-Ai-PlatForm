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
    PrismaModule,
    HealthModule,
    ChatModule,
    UploadModule,
    IngestModule,
    AuthModule,
    DashboardModule,
    ControlKbModule,
  ],
  providers: [Logger],
})
export class AppModule {}
