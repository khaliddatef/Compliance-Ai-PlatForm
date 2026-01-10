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

  navItems = [
    { label: 'Home', path: '/home', icon: 'home', action: 'newChat' },
    { label: 'Chat History', path: '/history', icon: 'history' },
    { label: 'Dashboard', path: '/dashboard', icon: 'dashboard' },
    { label: 'Uploaded Files', path: '/uploads', icon: 'uploads' },
    { label: 'Frameworks', path: '/frameworks', icon: 'frameworks' },
    { label: 'Settings', path: '/settings', icon: 'settings' }
  ];

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router
  ) {}

  get user() {
    return this.auth.user();
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }

  handleNavClick(item: { path: string; action?: string }, event: MouseEvent) {
    if (item.action !== 'newChat') return;
    event.preventDefault();
    this.router.navigate([item.path], { queryParams: { new: Date.now() } });
  }
}
