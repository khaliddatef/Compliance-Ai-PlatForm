import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css'
})
export class LoginPageComponent {
  email = '';
  name = '';

  constructor(private readonly auth: AuthService, private readonly router: Router) {}

  signIn() {
    this.auth.login(this.email, this.name);
    if (this.auth.isLoggedIn()) {
      this.router.navigate(['/home']);
    }
  }
}
