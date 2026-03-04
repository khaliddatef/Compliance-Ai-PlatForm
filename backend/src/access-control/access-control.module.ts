import { Global, Module } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { PolicyGuard } from './policy.guard';

@Global()
@Module({
  providers: [PolicyService, PolicyGuard],
  exports: [PolicyService, PolicyGuard],
})
export class AccessControlModule {}

