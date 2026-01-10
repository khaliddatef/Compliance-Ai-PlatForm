import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly sidebarOpenSignal = signal(false);
  private readonly rightPanelOpenSignal = signal(true);

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

  rightPanelOpen() {
    return this.rightPanelOpenSignal();
  }

  setRightPanelOpen(open: boolean) {
    this.rightPanelOpenSignal.set(open);
  }

  toggleRightPanel() {
    this.rightPanelOpenSignal.update((v) => !v);
  }

  closeRightPanel() {
    this.rightPanelOpenSignal.set(false);
  }
}
