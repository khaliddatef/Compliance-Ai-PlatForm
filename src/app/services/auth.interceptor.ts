import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const user = auth.user();

  if (!user?.id) {
    return next(req);
  }

  const withUser = req.clone({
    setHeaders: {
      'x-user-id': user.id,
    },
  });

  return next(withUser);
};
