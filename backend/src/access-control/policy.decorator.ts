import { SetMetadata } from '@nestjs/common';

export const POLICY_ROLES_KEY = 'policy_required_roles';

export type AppRole = 'ADMIN' | 'MANAGER' | 'USER';

export const RequireRoles = (...roles: AppRole[]) => SetMetadata(POLICY_ROLES_KEY, roles);

