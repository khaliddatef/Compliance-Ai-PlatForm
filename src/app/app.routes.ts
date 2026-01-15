import { Routes } from '@angular/router';
import { AppShellComponent } from './components/app-shell/app-shell.component';
import { ChatPageComponent } from './pages/chat-page/chat-page.component';
import { DashboardPageComponent } from './pages/dashboard-page/dashboard-page.component';
import { UploadsPageComponent } from './pages/uploads-page/uploads-page.component';
import { FrameworksPageComponent } from './pages/frameworks-page/frameworks-page.component';
import { FrameworkControlsPageComponent } from './pages/framework-controls-page/framework-controls-page.component';
import { LoginPageComponent } from './pages/login-page/login-page.component';
import { SettingsPageComponent } from './pages/settings-page/settings-page.component';
import { ChatHistoryPageComponent } from './pages/chat-history-page/chat-history-page.component';
import { ControlKbPageComponent } from './pages/control-kb-page/control-kb-page.component';
import { ControlDetailPageComponent } from './pages/control-detail-page/control-detail-page.component';
import { requireAuthGuard } from './guards/require-auth.guard';
import { redirectAuthGuard } from './guards/redirect-auth.guard';
import { requireAdminGuard } from './guards/require-admin.guard';
import { requireKbGuard } from './guards/require-kb.guard';

export const routes: Routes = [
  { path: 'login', component: LoginPageComponent, canActivate: [redirectAuthGuard] },
  {
    path: '',
    component: AppShellComponent,
    canActivate: [requireAuthGuard],
    children: [
      { path: 'home', component: ChatPageComponent, data: { title: 'Home' } },
      { path: 'history', component: ChatHistoryPageComponent, data: { title: 'Chat History' } },
      { path: 'dashboard', component: DashboardPageComponent, data: { title: 'Dashboard' } },
      { path: 'uploads', component: UploadsPageComponent, data: { title: 'Uploaded Files' } },
      { path: 'frameworks', component: FrameworksPageComponent, canActivate: [requireKbGuard], data: { title: 'Frameworks' } },
      { path: 'framework-controls', component: FrameworkControlsPageComponent, canActivate: [requireKbGuard], data: { title: 'Topics' } },
      { path: 'control-kb/:id', component: ControlDetailPageComponent, canActivate: [requireKbGuard], data: { title: 'Control Details' } },
      { path: 'control-kb', component: ControlKbPageComponent, canActivate: [requireKbGuard], data: { title: 'Control Knowledge Base' } },
      { path: 'settings', component: SettingsPageComponent, data: { title: 'Settings' } },
      { path: '', pathMatch: 'full', redirectTo: 'home' }
    ]
  },
  { path: '**', redirectTo: '' }
];
