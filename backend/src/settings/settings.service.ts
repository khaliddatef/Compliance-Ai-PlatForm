import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

type UserRole = AuthUser['role'];

const DIGEST_FREQUENCIES = ['INSTANT', 'DAILY', 'WEEKLY'] as const;
type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

const AI_RESPONSE_STYLES = ['CONCISE', 'BALANCED', 'DETAILED'] as const;
type AiResponseStyle = (typeof AI_RESPONSE_STYLES)[number];

const AI_LANGUAGES = ['AUTO', 'EN', 'AR'] as const;
type AiLanguage = (typeof AI_LANGUAGES)[number];

export type NotificationSettings = {
  emailAlerts: boolean;
  inAppAlerts: boolean;
  evidenceAlerts: boolean;
  gapAlerts: boolean;
  digestFrequency: DigestFrequency;
};

export type AiSettings = {
  responseStyle: AiResponseStyle;
  language: AiLanguage;
  includeCitations: boolean;
  temperature: number;
};

export type SettingsPermissions = {
  canManageTeam: boolean;
  canEditRoles: boolean;
  canInviteManager: boolean;
  canInviteAdmin: boolean;
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
};

export type TeamInvite = {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  status: 'PENDING' | 'CANCELED';
  invitedByUserId: string;
  invitedByName: string | null;
  invitedByEmail: string | null;
  message: string | null;
  createdAt: string;
  updatedAt: string;
};

type UserSettingsRow = {
  userId: string;
  notificationsJson: string;
  aiJson: string;
};

type TeamInviteRow = TeamInvite;

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  emailAlerts: true,
  inAppAlerts: true,
  evidenceAlerts: true,
  gapAlerts: true,
  digestFrequency: 'DAILY',
};

const DEFAULT_AI_SETTINGS: AiSettings = {
  responseStyle: 'BALANCED',
  language: 'AUTO',
  includeCitations: true,
  temperature: 0.2,
};

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  async getMySettings(user: AuthUser) {
    const row = await this.getOrCreateSettingsRow(user.id);
    return {
      notifications: this.normalizeNotificationSettings(this.parseJson(row.notificationsJson), DEFAULT_NOTIFICATION_SETTINGS),
      ai: this.normalizeAiSettings(this.parseJson(row.aiJson), DEFAULT_AI_SETTINGS),
      permissions: this.getPermissions(user.role),
    };
  }

  async updateNotifications(user: AuthUser, patch: Partial<NotificationSettings>) {
    const row = await this.getOrCreateSettingsRow(user.id);
    const current = this.normalizeNotificationSettings(this.parseJson(row.notificationsJson), DEFAULT_NOTIFICATION_SETTINGS);
    const next = this.normalizeNotificationSettings(patch, current);

    await this.prisma.$executeRaw`
      UPDATE "UserSettings"
      SET notificationsJson = ${JSON.stringify(next)}, updatedAt = datetime('now')
      WHERE userId = ${user.id}
    `;

    return next;
  }

  async updateAiSettings(user: AuthUser, patch: Partial<AiSettings>) {
    const row = await this.getOrCreateSettingsRow(user.id);
    const current = this.normalizeAiSettings(this.parseJson(row.aiJson), DEFAULT_AI_SETTINGS);
    const next = this.normalizeAiSettings(patch, current);

    await this.prisma.$executeRaw`
      UPDATE "UserSettings"
      SET aiJson = ${JSON.stringify(next)}, updatedAt = datetime('now')
      WHERE userId = ${user.id}
    `;

    return next;
  }

  async listTeamAccess(user: AuthUser) {
    this.assertTeamManageAccess(user);

    const members = await this.prisma.$queryRaw<TeamMember[]>`
      SELECT id, name, email, role, createdAt, updatedAt
      FROM "User"
      ORDER BY
        CASE role
          WHEN 'ADMIN' THEN 0
          WHEN 'MANAGER' THEN 1
          ELSE 2
        END ASC,
        name COLLATE NOCASE ASC
    `;

    const invites = await this.prisma.$queryRaw<TeamInviteRow[]>`
      SELECT
        ti.id,
        ti.name,
        ti.email,
        ti.role,
        ti.status,
        ti.invitedByUserId,
        u.name AS invitedByName,
        u.email AS invitedByEmail,
        ti.message,
        ti.createdAt,
        ti.updatedAt
      FROM "TeamInvite" ti
      LEFT JOIN "User" u ON u.id = ti.invitedByUserId
      WHERE ti.status = 'PENDING'
      ORDER BY datetime(ti.createdAt) DESC
    `;

    return { members, invites };
  }

  async createTeamInvite(
    user: AuthUser,
    payload: {
      email?: string;
      name?: string;
      role?: string;
      message?: string;
    },
  ) {
    this.assertTeamManageAccess(user);

    const email = String(payload.email || '').trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('email is required');
    }

    const role = this.normalizeRole(payload.role, 'USER');
    if (user.role !== 'ADMIN' && role !== 'USER') {
      throw new ForbiddenException('Only admins can invite managers or admins');
    }

    const existingUser = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM "User"
      WHERE lower(email) = ${email}
      LIMIT 1
    `;
    if (existingUser.length) {
      throw new BadRequestException('A user with this email already exists');
    }

    const existingInvite = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM "TeamInvite"
      WHERE lower(email) = ${email} AND status = 'PENDING'
      LIMIT 1
    `;
    if (existingInvite.length) {
      throw new BadRequestException('A pending invite already exists for this email');
    }

    const id = randomUUID();
    const name = this.toNullableText(payload.name, 120);
    const message = this.toNullableText(payload.message, 500);

    await this.prisma.$executeRaw`
      INSERT INTO "TeamInvite" (
        id,
        name,
        email,
        role,
        status,
        invitedByUserId,
        message,
        createdAt,
        updatedAt
      )
      VALUES (
        ${id},
        ${name},
        ${email},
        ${role},
        'PENDING',
        ${user.id},
        ${message},
        datetime('now'),
        datetime('now')
      )
    `;

    const rows = await this.prisma.$queryRaw<TeamInvite[]>`
      SELECT
        ti.id,
        ti.name,
        ti.email,
        ti.role,
        ti.status,
        ti.invitedByUserId,
        u.name AS invitedByName,
        u.email AS invitedByEmail,
        ti.message,
        ti.createdAt,
        ti.updatedAt
      FROM "TeamInvite" ti
      LEFT JOIN "User" u ON u.id = ti.invitedByUserId
      WHERE ti.id = ${id}
      LIMIT 1
    `;

    return rows[0];
  }

  async cancelTeamInvite(user: AuthUser, inviteId: string) {
    this.assertTeamManageAccess(user);

    const rows = await this.prisma.$queryRaw<TeamInvite[]>`
      SELECT id, invitedByUserId, status
      FROM "TeamInvite"
      WHERE id = ${inviteId}
      LIMIT 1
    `;
    const invite = rows[0];
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    if (user.role !== 'ADMIN' && invite.invitedByUserId !== user.id) {
      throw new ForbiddenException('Not allowed to cancel this invite');
    }

    await this.prisma.$executeRaw`
      UPDATE "TeamInvite"
      SET status = 'CANCELED', updatedAt = datetime('now')
      WHERE id = ${inviteId}
    `;

    return { ok: true };
  }

  async updateTeamMemberRole(
    user: AuthUser,
    userId: string,
    payload: {
      role?: string;
    },
  ) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }

    const role = this.normalizeRole(payload.role, 'USER');
    if (user.id === userId && role !== 'ADMIN') {
      throw new BadRequestException('You cannot remove your own admin role');
    }

    const existing = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM "User"
      WHERE id = ${userId}
      LIMIT 1
    `;
    if (!existing.length) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.$executeRaw`
      UPDATE "User"
      SET role = ${role}, updatedAt = datetime('now')
      WHERE id = ${userId}
    `;

    const rows = await this.prisma.$queryRaw<TeamMember[]>`
      SELECT id, name, email, role, createdAt, updatedAt
      FROM "User"
      WHERE id = ${userId}
      LIMIT 1
    `;

    return rows[0];
  }

  private async getOrCreateSettingsRow(userId: string) {
    let rows = await this.prisma.$queryRaw<UserSettingsRow[]>`
      SELECT userId, notificationsJson, aiJson
      FROM "UserSettings"
      WHERE userId = ${userId}
      LIMIT 1
    `;

    if (!rows.length) {
      try {
        await this.prisma.$executeRaw`
          INSERT INTO "UserSettings" (userId, notificationsJson, aiJson, createdAt, updatedAt)
          VALUES (
            ${userId},
            ${JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS)},
            ${JSON.stringify(DEFAULT_AI_SETTINGS)},
            datetime('now'),
            datetime('now')
          )
        `;
      } catch {
        // Ignore duplicate insert race and load row again.
      }
      rows = await this.prisma.$queryRaw<UserSettingsRow[]>`
        SELECT userId, notificationsJson, aiJson
        FROM "UserSettings"
        WHERE userId = ${userId}
        LIMIT 1
      `;
    }

    if (!rows.length) {
      return {
        userId,
        notificationsJson: JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS),
        aiJson: JSON.stringify(DEFAULT_AI_SETTINGS),
      };
    }

    return rows[0];
  }

  private normalizeNotificationSettings(
    input: unknown,
    fallback: NotificationSettings,
  ): NotificationSettings {
    const source = this.asObject(input);
    const digestRaw = String(source['digestFrequency'] || '').toUpperCase();
    const digestFrequency = DIGEST_FREQUENCIES.includes(digestRaw as DigestFrequency)
      ? (digestRaw as DigestFrequency)
      : fallback.digestFrequency;

    return {
      emailAlerts: this.toBoolean(source['emailAlerts'], fallback.emailAlerts),
      inAppAlerts: this.toBoolean(source['inAppAlerts'], fallback.inAppAlerts),
      evidenceAlerts: this.toBoolean(source['evidenceAlerts'], fallback.evidenceAlerts),
      gapAlerts: this.toBoolean(source['gapAlerts'], fallback.gapAlerts),
      digestFrequency,
    };
  }

  private normalizeAiSettings(input: unknown, fallback: AiSettings): AiSettings {
    const source = this.asObject(input);

    const responseStyleRaw = String(source['responseStyle'] || '').toUpperCase();
    const responseStyle = AI_RESPONSE_STYLES.includes(responseStyleRaw as AiResponseStyle)
      ? (responseStyleRaw as AiResponseStyle)
      : fallback.responseStyle;

    const languageRaw = String(source['language'] || '').toUpperCase();
    const language = AI_LANGUAGES.includes(languageRaw as AiLanguage)
      ? (languageRaw as AiLanguage)
      : fallback.language;

    const parsedTemperature = Number(source['temperature']);
    const temperature = Number.isFinite(parsedTemperature)
      ? Math.min(Math.max(parsedTemperature, 0), 1)
      : fallback.temperature;

    return {
      responseStyle,
      language,
      includeCitations: this.toBoolean(source['includeCitations'], fallback.includeCitations),
      temperature,
    };
  }

  private normalizeRole(input: unknown, fallback: UserRole): UserRole {
    const role = String(input || fallback).trim().toUpperCase() as UserRole;
    if (role !== 'ADMIN' && role !== 'MANAGER' && role !== 'USER') {
      throw new BadRequestException('Invalid role');
    }
    return role;
  }

  private getPermissions(role: UserRole): SettingsPermissions {
    const canManageTeam = role === 'ADMIN' || role === 'MANAGER';
    return {
      canManageTeam,
      canEditRoles: role === 'ADMIN',
      canInviteManager: role === 'ADMIN',
      canInviteAdmin: role === 'ADMIN',
    };
  }

  private assertTeamManageAccess(user: AuthUser) {
    if (user.role === 'USER') {
      throw new ForbiddenException('Team access is restricted');
    }
  }

  private parseJson(value: string) {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  private asObject(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {} as Record<string, unknown>;
    }
    return value as Record<string, unknown>;
  }

  private toBoolean(value: unknown, fallback: boolean) {
    return typeof value === 'boolean' ? value : fallback;
  }

  private toNullableText(value: unknown, maxLength: number) {
    const text = String(value || '').trim();
    if (!text) return null;
    return text.slice(0, maxLength);
  }

  private async ensureSchema() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "UserSettings" (
        userId TEXT PRIMARY KEY,
        notificationsJson TEXT NOT NULL,
        aiJson TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "TeamInvite" (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'USER',
        status TEXT NOT NULL DEFAULT 'PENDING',
        invitedByUserId TEXT NOT NULL,
        message TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "TeamInvite_email_idx"
      ON "TeamInvite"(email)
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "TeamInvite_status_idx"
      ON "TeamInvite"(status)
    `);
  }
}
