import { ForbiddenException } from '@nestjs/common';
import { PolicyService } from './policy.service';

describe('PolicyService', () => {
  let service: PolicyService;

  beforeEach(() => {
    service = new PolicyService();
  });

  it('normalizes unknown role to USER', () => {
    expect(service.normalizeRole('manager')).toBe('MANAGER');
    expect(service.normalizeRole('ADMIN')).toBe('ADMIN');
    expect(service.normalizeRole('invalid')).toBe('USER');
  });

  it('checks role membership', () => {
    expect(service.can('ADMIN', ['ADMIN'])).toBe(true);
    expect(service.can('USER', ['ADMIN', 'MANAGER'])).toBe(false);
  });

  it('throws when manager/admin required and user role is USER', () => {
    expect(() => service.assertManagerOrAdmin({ role: 'USER' } as any)).toThrow(ForbiddenException);
  });

  it('allows manager/admin checks for manager and admin', () => {
    expect(() => service.assertManagerOrAdmin({ role: 'MANAGER' } as any)).not.toThrow();
    expect(() => service.assertManagerOrAdmin({ role: 'ADMIN' } as any)).not.toThrow();
  });
});
