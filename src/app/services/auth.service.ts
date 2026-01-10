import { Injectable, signal } from '@angular/core';

export type AuthUser = {
  name: string;
  email: string;
};

const STORAGE_KEY = 'tekronyx.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userSignal = signal<AuthUser | null>(this.loadUser());

  user() {
    return this.userSignal();
  }

  isLoggedIn() {
    return !!this.userSignal();
  }

  login(email: string, name?: string) {
    const cleanEmail = email?.trim();
    if (!cleanEmail) return;
    const fallbackName = cleanEmail.split('@')[0] || 'User';
    const user: AuthUser = {
      name: (name || fallbackName).trim(),
      email: cleanEmail
    };
    this.userSignal.set(user);
    this.saveUser(user);
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
      return parsed?.email ? parsed : null;
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
