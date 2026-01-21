import { ApplicationRef, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpInterceptorFn } from '@angular/common/http';
import { finalize } from 'rxjs/operators';

let tickQueued = false;

const scheduleTick = (appRef: ApplicationRef) => {
  if (tickQueued) return;
  tickQueued = true;

  const run = () => {
    tickQueued = false;
    appRef.tick();
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(run));
  } else {
    setTimeout(run, 0);
  }
};

export const changeDetectionInterceptor: HttpInterceptorFn = (req, next) => {
  const appRef = inject(ApplicationRef);
  const platformId = inject(PLATFORM_ID);
  const isBrowser = isPlatformBrowser(platformId);

  return next(req).pipe(
    finalize(() => {
      if (!isBrowser) return;
      scheduleTick(appRef);
    }),
  );
};
