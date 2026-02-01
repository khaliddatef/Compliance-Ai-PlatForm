import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map } from 'rxjs/operators';

export const requireKbGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.ensureSession().pipe(
    map(() => {
      const role = auth.user()?.role || 'USER';
      return role === 'ADMIN' || role === 'MANAGER'
        ? true
        : router.createUrlTree(['/home']);
    }),
  );
};
