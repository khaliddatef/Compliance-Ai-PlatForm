import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly sidebarOpenSignal = signal(true);

  sidebarOpen() {
    return this.sidebarOpenSignal();
  }

  setSidebarOpen(open: boolean) {
    this.sidebarOpenSignal.set(open);
  }

  toggleSidebar() {
    this.sidebarOpenSignal.update((v) => !v);
  }

  closeSidebar() {
    this.sidebarOpenSignal.set(false);
  }
}
