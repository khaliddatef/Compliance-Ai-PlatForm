import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { POLICY_ROLES_KEY, type AppRole } from './policy.decorator';
import { PolicyService } from './policy.service';

@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policy: PolicyService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppRole[]>(POLICY_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || !required.length) return true;

    const req = context.switchToHttp().getRequest();
    const userRole = req?.user?.role;
    if (!this.policy.can(userRole, required)) {
      throw new ForbiddenException('Insufficient role permissions');
    }
    return true;
  }
}

