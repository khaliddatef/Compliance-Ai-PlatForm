import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ControlKbService } from './control-kb.service';
import { ControlKbController } from './control-kb.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [ControlKbService],
  controllers: [ControlKbController],
  exports: [ControlKbService],
})
export class ControlKbModule {}
