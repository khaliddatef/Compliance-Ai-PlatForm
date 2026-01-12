import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatModule } from './chat/chat.module';
import { HealthModule } from './health/health.module';
import { UploadModule } from './upload/upload.module';
import { PrismaModule } from './prisma/prisma.module';
import { IngestModule } from './ingest/ingest.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ControlKbModule } from './control-kb/control-kb.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
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
