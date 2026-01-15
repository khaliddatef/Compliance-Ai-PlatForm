import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css'
})
export class SidebarComponent {
  @Input() open = true;
  @Output() toggleSidebar = new EventEmitter<void>();

  private readonly allNavItems = [
    { label: 'Home', path: '/home', icon: 'home' },
    { label: 'Chat History', path: '/history', icon: 'history' },
    { label: 'Dashboard', path: '/dashboard', icon: 'dashboard' },
    { label: 'Uploaded Files', path: '/uploads', icon: 'uploads' },
    { label: 'Frameworks', path: '/frameworks', icon: 'frameworks' },
    { label: 'Control KB', path: '/control-kb', icon: 'kb' },
    { label: 'Settings', path: '/settings', icon: 'settings' }
  ];

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router
  ) {}

  get user() {
    return this.auth.user();
  }

  get navItems() {
    const role = (this.user?.role || 'USER').toUpperCase();
    if (role === 'USER') {
      return this.allNavItems.filter(
        (item) => item.path !== '/dashboard' && item.path !== '/frameworks' && item.path !== '/control-kb'
      );
    }
    if (role === 'MANAGER') {
      return this.allNavItems;
    }
    return this.allNavItems;
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }

}
