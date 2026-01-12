import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-frameworks-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './frameworks-page.component.html',
  styleUrl: './frameworks-page.component.css'
})
export class FrameworksPageComponent {
  frameworks = [
    { name: 'ISO 27001', status: 'Active', coverage: '72%' },
    { name: 'FRA Egypt', status: 'Draft', coverage: '41%' },
    { name: 'SOC 2', status: 'Active', coverage: '58%' }
  ];

  constructor(private readonly auth: AuthService) {}

  get isAdmin() {
    return this.auth.user()?.role === 'ADMIN';
  }
}
