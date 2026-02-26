import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  ApiService,
  SettingsAi,
  SettingsNotifications,
  SettingsPermissions,
  TeamInvite,
  TeamMember,
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

type SettingsSection = 'notifications' | 'ai' | 'team';

const DEFAULT_NOTIFICATION_SETTINGS: SettingsNotifications = {
  emailAlerts: true,
  inAppAlerts: true,
  evidenceAlerts: true,
  gapAlerts: true,
  digestFrequency: 'DAILY',
};

const DEFAULT_AI_SETTINGS: SettingsAi = {
  responseStyle: 'BALANCED',
  language: 'AUTO',
  includeCitations: true,
  temperature: 0.2,
};

const DEFAULT_PERMISSIONS: SettingsPermissions = {
  canManageTeam: false,
  canEditRoles: false,
  canInviteManager: false,
  canInviteAdmin: false,
};

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.css',
})
export class SettingsPageComponent implements OnInit {
  loading = true;
  loadingTeam = false;
  savingNotifications = false;
  savingAi = false;
  inviting = false;
  updatingRoleUserId = '';
  cancelingInviteId = '';

  error = '';
  notificationsMessage = '';
  aiMessage = '';
  teamMessage = '';
  teamError = '';

  expandedSection: SettingsSection | null = null;
  notifications: SettingsNotifications = { ...DEFAULT_NOTIFICATION_SETTINGS };
  ai: SettingsAi = { ...DEFAULT_AI_SETTINGS };
  permissions: SettingsPermissions = { ...DEFAULT_PERMISSIONS };

  teamMembers: TeamMember[] = [];
  teamInvites: TeamInvite[] = [];

  inviteDraft: {
    email: string;
    name: string;
    role: 'ADMIN' | 'MANAGER' | 'USER';
    message: string;
  } = {
    email: '',
    name: '',
    role: 'USER',
    message: '',
  };

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly api: ApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.loadSettings();
  }

  get user() {
    return this.auth.user();
  }

  get canManageTeam() {
    return this.permissions.canManageTeam;
  }

  get canEditRoles() {
    return this.permissions.canEditRoles;
  }

  get inviteRoleOptions() {
    const options: Array<{ value: 'ADMIN' | 'MANAGER' | 'USER'; label: string }> = [
      { value: 'USER', label: 'Reviewer' },
    ];
    if (this.permissions.canInviteManager) {
      options.push({ value: 'MANAGER', label: 'Manager' });
    }
    if (this.permissions.canInviteAdmin) {
      options.push({ value: 'ADMIN', label: 'Admin' });
    }
    return options;
  }

  get memberRoleOptions() {
    return [
      { value: 'USER' as const, label: 'Reviewer' },
      { value: 'MANAGER' as const, label: 'Manager' },
      { value: 'ADMIN' as const, label: 'Admin' },
    ];
  }

  isCurrentUser(member: TeamMember) {
    return !!this.user && member.id === this.user.id;
  }

  toggleSection(section: SettingsSection) {
    this.clearSectionMessages();
    this.expandedSection = this.expandedSection === section ? null : section;
    if (this.expandedSection === 'team' && this.canManageTeam && !this.loadingTeam && !this.teamMembers.length) {
      this.loadTeamAccess();
    }
  }

  saveNotifications() {
    if (this.savingNotifications) return;
    this.savingNotifications = true;
    this.notificationsMessage = '';

    this.api.updateSettingsNotifications(this.notifications).subscribe({
      next: (res) => {
        this.notifications = {
          ...DEFAULT_NOTIFICATION_SETTINGS,
          ...(res?.notifications || {}),
        };
        this.notificationsMessage = 'Notification settings saved.';
        this.savingNotifications = false;
        this.refreshView();
      },
      error: (error: unknown) => {
        this.notificationsMessage = this.extractError(error, 'Unable to save notification settings.');
        this.savingNotifications = false;
        this.refreshView();
      },
    });
  }

  saveAiSettings() {
    if (this.savingAi) return;
    this.savingAi = true;
    this.aiMessage = '';

    this.api.updateSettingsAi(this.ai).subscribe({
      next: (res) => {
        this.ai = {
          ...DEFAULT_AI_SETTINGS,
          ...(res?.ai || {}),
        };
        this.aiMessage = 'AI assistant settings saved.';
        this.savingAi = false;
        this.refreshView();
      },
      error: (error: unknown) => {
        this.aiMessage = this.extractError(error, 'Unable to save AI settings.');
        this.savingAi = false;
        this.refreshView();
      },
    });
  }

  sendInvite() {
    if (!this.canManageTeam || this.inviting) return;

    const email = String(this.inviteDraft.email || '').trim().toLowerCase();
    if (!email) {
      this.teamMessage = 'Invite email is required.';
      return;
    }

    const role = this.normalizeInviteRole(this.inviteDraft.role);

    this.inviting = true;
    this.teamMessage = '';
    this.api
      .createTeamInvite({
        email,
        name: String(this.inviteDraft.name || '').trim() || undefined,
        role,
        message: String(this.inviteDraft.message || '').trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.inviting = false;
          this.teamMessage = 'Invite sent successfully.';
          this.inviteDraft = {
            email: '',
            name: '',
            role: 'USER',
            message: '',
          };
          this.loadTeamAccess();
          this.refreshView();
        },
        error: (error: unknown) => {
          this.inviting = false;
          this.teamMessage = this.extractError(error, 'Unable to send invite.');
          this.refreshView();
        },
      });
  }

  cancelInvite(invite: TeamInvite) {
    if (this.cancelingInviteId) return;
    const confirmCancel = window.confirm(`Cancel invite for ${invite.email}?`);
    if (!confirmCancel) return;

    this.cancelingInviteId = invite.id;
    this.teamMessage = '';
    this.api.cancelTeamInvite(invite.id).subscribe({
      next: () => {
        this.cancelingInviteId = '';
        this.teamMessage = 'Invite canceled.';
        this.loadTeamAccess();
        this.refreshView();
      },
      error: (error: unknown) => {
        this.cancelingInviteId = '';
        this.teamMessage = this.extractError(error, 'Unable to cancel invite.');
        this.refreshView();
      },
    });
  }

  updateMemberRole(member: TeamMember, roleValue: string) {
    if (!this.canEditRoles || this.updatingRoleUserId) return;

    const nextRole = this.normalizeRole(roleValue, member.role);
    if (nextRole === member.role) return;

    if (this.isCurrentUser(member) && nextRole !== 'ADMIN') {
      this.teamMessage = 'You cannot remove your own admin role.';
      return;
    }

    this.updatingRoleUserId = member.id;
    this.teamMessage = '';
    this.api.updateTeamMemberRole(member.id, nextRole).subscribe({
      next: () => {
        this.updatingRoleUserId = '';
        this.teamMessage = 'Team role updated.';
        this.loadTeamAccess();
        this.refreshView();
      },
      error: (error: unknown) => {
        this.updatingRoleUserId = '';
        this.teamMessage = this.extractError(error, 'Unable to update team role.');
        this.refreshView();
      },
    });
  }

  refreshTeam() {
    if (!this.canManageTeam) return;
    this.loadTeamAccess();
  }

  canCancelInvite(invite: TeamInvite) {
    if (this.canEditRoles) return true;
    return !!this.user?.id && invite.invitedByUserId === this.user.id;
  }

  trackByMember(_index: number, member: TeamMember) {
    return member.id;
  }

  trackByInvite(_index: number, invite: TeamInvite) {
    return invite.id;
  }

  trackByRoleOption(_index: number, option: { value: 'ADMIN' | 'MANAGER' | 'USER' }) {
    return option.value;
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }

  private loadSettings() {
    this.loading = true;
    this.error = '';
    this.api.getSettingsMe().subscribe({
      next: (res) => {
        this.notifications = {
          ...DEFAULT_NOTIFICATION_SETTINGS,
          ...(res?.notifications || {}),
        };
        this.ai = {
          ...DEFAULT_AI_SETTINGS,
          ...(res?.ai || {}),
        };
        this.permissions = {
          ...DEFAULT_PERMISSIONS,
          ...(res?.permissions || {}),
        };
        if (this.permissions.canManageTeam) {
          this.loadTeamAccess();
        } else {
          this.teamMembers = [];
          this.teamInvites = [];
        }
        this.loading = false;
        this.refreshView();
      },
      error: (error: unknown) => {
        this.error = this.extractError(error, 'Unable to load settings right now.');
        this.loading = false;
        this.refreshView();
      },
    });
  }

  private loadTeamAccess() {
    if (!this.canManageTeam) return;
    this.loadingTeam = true;
    this.teamError = '';

    this.api.listTeamAccess().subscribe({
      next: (res) => {
        this.teamMembers = Array.isArray(res?.members) ? res.members : [];
        this.teamInvites = Array.isArray(res?.invites) ? res.invites : [];
        this.loadingTeam = false;
        this.refreshView();
      },
      error: (error: unknown) => {
        this.teamError = this.extractError(error, 'Unable to load team access.');
        this.loadingTeam = false;
        this.refreshView();
      },
    });
  }

  private clearSectionMessages() {
    this.notificationsMessage = '';
    this.aiMessage = '';
    this.teamMessage = '';
  }

  private normalizeInviteRole(input: unknown): 'ADMIN' | 'MANAGER' | 'USER' {
    const role = this.normalizeRole(input, 'USER');
    if (role === 'ADMIN' && !this.permissions.canInviteAdmin) return 'USER';
    if (role === 'MANAGER' && !this.permissions.canInviteManager) return 'USER';
    return role;
  }

  private normalizeRole(input: unknown, fallback: 'ADMIN' | 'MANAGER' | 'USER'): 'ADMIN' | 'MANAGER' | 'USER' {
    const role = String(input || fallback).trim().toUpperCase();
    if (role === 'ADMIN' || role === 'MANAGER' || role === 'USER') {
      return role;
    }
    return fallback;
  }

  private extractError(error: unknown, fallback: string) {
    if (error instanceof HttpErrorResponse) {
      const message = (error.error && (error.error.message as string)) || error.message;
      if (message) return String(message);
    }
    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }

  private refreshView() {
    this.cdr.detectChanges();
  }
}
