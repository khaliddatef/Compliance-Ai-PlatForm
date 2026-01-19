import { Injectable, signal } from '@angular/core';
import { map, tap } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { ApiService } from './api.service';

export type AuthUser = {
  id?: string;
  name: string;
  email: string;
  role?: 'ADMIN' | 'MANAGER' | 'USER';
};

const USER_STORAGE_KEY = 'tekronyx.user';
const TOKEN_STORAGE_KEY = 'tekronyx.token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userSignal = signal<AuthUser | null>(this.loadUser());
  private readonly tokenSignal = signal<string | null>(this.loadToken());

  constructor(private readonly api: ApiService) {}

  user() {
    return this.userSignal();
  }

  token() {
    return this.tokenSignal();
  }

  isLoggedIn() {
    return !!this.userSignal() && !!this.tokenSignal();
  }

  login(email: string, password: string) {
    const cleanEmail = email?.trim();
    if (!cleanEmail || !password) {
      return throwError(() => new Error('Email and password are required.'));
    }

    return this.api.login(cleanEmail, password).pipe(
      tap((res) => {
        const user = res?.user;
        const token = res?.token;
        if (!user?.email || !token) {
          throw new Error('Invalid login response.');
        }
        const nextUser: AuthUser = {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
        this.userSignal.set(nextUser);
        this.saveUser(nextUser);
        this.tokenSignal.set(token);
        this.saveToken(token);
      }),
      map(() => true),
    );
  }

  logout() {
    this.userSignal.set(null);
    this.clearUser();
    this.tokenSignal.set(null);
    this.clearToken();
  }

  private loadUser(): AuthUser | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(USER_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AuthUser;
      if (!parsed?.email) return null;
      return { ...parsed, role: parsed.role || 'USER' };
    } catch {
      return null;
    }
  }

  private saveUser(user: AuthUser) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  }

  private clearUser() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(USER_STORAGE_KEY);
  }

  private loadToken(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
      return raw ? String(raw) : null;
    } catch {
      return null;
    }
  }

  private saveToken(token: string) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }

  private clearToken() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}
