import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, effect } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
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
  sidebarOpen = false;
  isMobile = false;
  private lastIsMobile = false;
  pageTitle = 'Home';

  constructor(
    private readonly layout: LayoutService,
    private readonly router: Router,
    private readonly route: ActivatedRoute
  ) {
    effect(() => {
      this.sidebarOpen = this.layout.sidebarOpen();
    });
  }

  ngOnInit() {
    this.updateViewportState();
    this.updatePageTitle();
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => this.updatePageTitle());
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
      if (mobile) {
        this.layout.closeSidebar();
      }
      this.lastIsMobile = mobile;
    }
    this.isMobile = mobile;
  }

  private updatePageTitle() {
    let current: ActivatedRoute | null = this.route;
    while (current?.firstChild) {
      current = current.firstChild;
    }
    this.pageTitle = current?.snapshot.data['title'] ?? 'Home';
  }
}
