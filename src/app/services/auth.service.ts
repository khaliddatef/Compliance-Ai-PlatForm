import { Injectable, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, tap, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { ChatService } from './chat.service';

export type AuthUser = {
  id?: string;
  name: string;
  email: string;
  role?: 'ADMIN' | 'MANAGER' | 'USER';
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userSignal = signal<AuthUser | null>(null);
  private sessionChecked = false;
  private sessionCheckRequest?: Observable<boolean>;

  constructor(
    private readonly api: ApiService,
    private readonly chatService: ChatService,
  ) {}

  user() {
    return this.userSignal();
  }

  isLoggedIn() {
    return !!this.userSignal();
  }

  ensureSession() {
    if (typeof window === 'undefined') return of(false);
    if (this.userSignal()) return of(true);
    if (this.sessionChecked) return of(false);
    if (this.sessionCheckRequest) return this.sessionCheckRequest;

    this.sessionCheckRequest = this.api.me().pipe(
      tap((res) => {
        const user = res?.user;
        if (user?.email) {
          this.userSignal.set({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          });
        } else {
          this.userSignal.set(null);
        }
        this.sessionChecked = true;
      }),
      map(() => !!this.userSignal()),
      catchError(() => {
        this.userSignal.set(null);
        this.sessionChecked = true;
        return of(false);
      }),
      finalize(() => {
        this.sessionCheckRequest = undefined;
      }),
      shareReplay(1),
    );

    return this.sessionCheckRequest;
  }

  login(email: string, password: string) {
    const cleanEmail = email?.trim();
    if (!cleanEmail || !password) {
      return throwError(() => new Error('Email and password are required.'));
    }

    return this.api.login(cleanEmail, password).pipe(
      tap((res) => {
        const user = res?.user;
        if (!user?.email) {
          throw new Error('Invalid login response.');
        }
        this.userSignal.set({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        });
        this.sessionChecked = true;
        this.sessionCheckRequest = undefined;
        this.chatService.resetForUser();
      }),
      map(() => true),
    );
  }

  logout() {
    this.userSignal.set(null);
    this.sessionChecked = true;
    this.sessionCheckRequest = undefined;
    this.chatService.resetForUser();
    this.api.logout().subscribe({
      next: () => {},
      error: () => {},
    });
  }
}
