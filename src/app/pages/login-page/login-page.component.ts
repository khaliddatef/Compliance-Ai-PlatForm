import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css'
})
export class LoginPageComponent {
  email = '';
  password = '';
  loading = false;
  error = '';
  readonly testAccounts = [
    { name: 'Mostafa', email: 'mostafa@tekronyx.com', role: 'User' },
    { name: 'Omar', email: 'wasamy.omar@tekronyx.com', role: 'Manager' },
    { name: 'Khaled', email: 'khaled@tekronyx.com', role: 'Admin' },
  ];
  selectedTestEmail =
    this.testAccounts.find((account) => account.role.toLowerCase() === 'admin')?.email ||
    this.testAccounts[0]?.email ||
    '';

  constructor(private readonly auth: AuthService, private readonly router: Router) {}

  signIn() {
    this.error = '';
    this.loading = true;

    this.auth
      .login(this.email, this.password)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: () => {
          this.router.navigate(['/home']);
        },
        error: (err) => {
          this.error = err?.error?.message || 'Invalid email or password.';
        },
      });
  }

  signInAs(account: { email: string }) {
    this.email = account.email;
    this.password = 'Tekronyx@123';
    this.signIn();
  }

  useSelectedTest() {
    const target = this.testAccounts.find((account) => account.email === this.selectedTestEmail);
    if (!target) return;
    this.signInAs(target);
  }
}
