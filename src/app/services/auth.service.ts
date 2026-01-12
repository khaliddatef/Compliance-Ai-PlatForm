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

const STORAGE_KEY = 'tekronyx.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userSignal = signal<AuthUser | null>(this.loadUser());

  constructor(private readonly api: ApiService) {}

  user() {
    return this.userSignal();
  }

  isLoggedIn() {
    return !!this.userSignal();
  }

  login(email: string, password: string) {
    const cleanEmail = email?.trim();
    if (!cleanEmail || !password) {
      return throwError(() => new Error('Email and password are required.'));
    }

    return this.api.login(cleanEmail, password).pipe(
      map((res) => res?.user),
      tap((user) => {
        if (!user?.email) {
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
      }),
      map(() => true),
    );
  }

  logout() {
    this.userSignal.set(null);
    this.clearUser();
  }

  private loadUser(): AuthUser | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  }

  private clearUser() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
