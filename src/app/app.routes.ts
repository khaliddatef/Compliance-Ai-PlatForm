import { Routes } from '@angular/router';
import { AppShellComponent } from './components/app-shell/app-shell.component';
import { ChatPageComponent } from './pages/chat-page/chat-page.component';

export const routes: Routes = [
  {
    path: '',
    component: AppShellComponent,
    children: [
      { path: '', component: ChatPageComponent }
    ]
  },
  { path: '**', redirectTo: '' }
];
