import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const requireAdminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const role = auth.user()?.role || 'USER';
  if (role === 'ADMIN') {
    return true;
  }

  return router.createUrlTree(['/home']);
};
