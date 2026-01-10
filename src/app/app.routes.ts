import { Routes } from '@angular/router';
import { AppShellComponent } from './components/app-shell/app-shell.component';
import { ChatPageComponent } from './pages/chat-page/chat-page.component';
import { DashboardPageComponent } from './pages/dashboard-page/dashboard-page.component';
import { UploadsPageComponent } from './pages/uploads-page/uploads-page.component';
import { FrameworksPageComponent } from './pages/frameworks-page/frameworks-page.component';
import { LoginPageComponent } from './pages/login-page/login-page.component';
import { SettingsPageComponent } from './pages/settings-page/settings-page.component';
import { ChatHistoryPageComponent } from './pages/chat-history-page/chat-history-page.component';

export const routes: Routes = [
  { path: 'login', component: LoginPageComponent },
  {
    path: '',
    component: AppShellComponent,
    children: [
      { path: 'home', component: ChatPageComponent, data: { title: 'Home' } },
      { path: 'history', component: ChatHistoryPageComponent, data: { title: 'Chat History' } },
      { path: 'dashboard', component: DashboardPageComponent, data: { title: 'Dashboard' } },
      { path: 'uploads', component: UploadsPageComponent, data: { title: 'Uploaded Files' } },
      { path: 'frameworks', component: FrameworksPageComponent, data: { title: 'Frameworks' } },
      { path: 'settings', component: SettingsPageComponent, data: { title: 'Settings' } },
      { path: '', pathMatch: 'full', redirectTo: 'home' }
    ]
  },
  { path: '**', redirectTo: '' }
];
