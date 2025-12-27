import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, effect } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { LayoutService } from '../../services/layout.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.css'
})
export class AppShellComponent implements OnInit {
  sidebarOpen = true;
  isMobile = false;
  private lastIsMobile = false;

  constructor(private readonly layout: LayoutService) {
    effect(() => {
      this.sidebarOpen = this.layout.sidebarOpen();
    });
  }

  ngOnInit() {
    this.updateViewportState();
  }

  @HostListener('window:resize')
  onResize() {
    this.updateViewportState();
  }

  toggleSidebar() {
    this.layout.toggleSidebar();
  }

  closeSidebar() {
    this.layout.closeSidebar();
  }

  private updateViewportState() {
    const mobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false;
    if (mobile !== this.lastIsMobile) {
      this.layout.setSidebarOpen(!mobile);
      this.lastIsMobile = mobile;
    }
    this.isMobile = mobile;
  }
}
