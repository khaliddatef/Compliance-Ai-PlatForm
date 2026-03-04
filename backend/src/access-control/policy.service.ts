import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service';
import type { AppRole } from './policy.decorator';

@Injectable()
export class PolicyService {
  readonly matrix = {
    'api/evidence:list': ['ADMIN', 'MANAGER', 'USER'] as AppRole[],
    'api/evidence:view': ['ADMIN', 'MANAGER', 'USER'] as AppRole[],
    'api/evidence:quality-view': ['ADMIN', 'MANAGER', 'USER'] as AppRole[],
    'api/evidence:quality-recompute': ['ADMIN', 'MANAGER'] as AppRole[],
    'api/evidence:review': ['ADMIN', 'MANAGER'] as AppRole[],
    'api/evidence:link': ['ADMIN', 'MANAGER'] as AppRole[],
    'api/evidence-requests:list': ['ADMIN', 'MANAGER', 'USER'] as AppRole[],
    'api/evidence-requests:create': ['ADMIN', 'MANAGER'] as AppRole[],
    'api/evidence-requests:fulfill': ['ADMIN', 'MANAGER', 'USER'] as AppRole[],
    'api/copilot-actions:execute': ['ADMIN', 'MANAGER'] as AppRole[],
    'api/audit:list': ['ADMIN', 'MANAGER'] as AppRole[],
    'api/control-status:view': ['ADMIN', 'MANAGER', 'USER'] as AppRole[],
    'api/control-status:request-evidence': ['ADMIN', 'MANAGER'] as AppRole[],
    'api/audit-pack:generate': ['ADMIN', 'MANAGER'] as AppRole[],
    'api/audit-pack:view': ['ADMIN', 'MANAGER'] as AppRole[],
    'api/connectors:manage': ['ADMIN', 'MANAGER'] as AppRole[],
  } as const;

  normalizeRole(input: unknown): AppRole {
    const role = String(input || '').trim().toUpperCase();
    if (role === 'ADMIN' || role === 'MANAGER' || role === 'USER') return role;
    return 'USER';
  }

  can(role: unknown, allowed: AppRole[]) {
    const normalized = this.normalizeRole(role);
    return allowed.includes(normalized);
  }

  assert(role: unknown, allowed: AppRole[], message = 'Forbidden') {
    if (!this.can(role, allowed)) {
      throw new ForbiddenException(message);
    }
  }

  assertManagerOrAdmin(user?: AuthUser, message = 'Manager or Admin access required') {
    const role = this.normalizeRole(user?.role);
    if (role !== 'MANAGER' && role !== 'ADMIN') {
      throw new ForbiddenException(message);
    }
  }

  assertAdmin(user?: AuthUser, message = 'Admin access required') {
    const role = this.normalizeRole(user?.role);
    if (role !== 'ADMIN') {
      throw new ForbiddenException(message);
    }
  }
}
