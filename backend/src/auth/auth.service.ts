import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password.util';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MANAGER' | 'USER';
};

type AuthUserRow = AuthUser & { passwordHash: string };

const SEED_USERS: Array<{ name: string; email: string; role: AuthUser['role'] }> = [
  { name: 'Mostafa', email: 'mostafa@tekronyx.com', role: 'USER' },
  { name: 'Omar', email: 'wasamy.omar@tekronyx.com', role: 'MANAGER' },
  { name: 'Khaled', email: 'khaled@tekronyx.com', role: 'ADMIN' },
];

type AuthTokenPayload = JwtPayload & { sub: string };

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureSchema();
    await this.ensureSeedUsers();
  }

  async validateUser(email: string, password: string): Promise<AuthUser | null> {
    const rows = await this.prisma.$queryRaw<AuthUserRow[]>`
      SELECT id, name, email, passwordHash, role
      FROM "User"
      WHERE email = ${email}
      LIMIT 1
    `;
    const user = rows[0];
    if (!user) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    const role = String((user as any).role || 'USER').toUpperCase() as AuthUser['role'];
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role,
    };
  }

  issueToken(user: AuthUser) {
    const payload = { sub: user.id };
    return jwt.sign(payload, this.getJwtSecret(), {
      expiresIn: this.getJwtTtl() as jwt.SignOptions['expiresIn'],
    });
  }

  verifyToken(token: string): AuthTokenPayload {
    const payload = jwt.verify(token, this.getJwtSecret());
    if (!payload || typeof payload === 'string') {
      throw new Error('Invalid token payload');
    }
    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new Error('Invalid token subject');
    }
    return payload as AuthTokenPayload;
  }

  getJwtTtl() {
    return process.env.JWT_EXPIRES_IN || '8h';
  }

  async getUserById(id: string): Promise<AuthUser | null> {
    const rows = await this.prisma.$queryRaw<AuthUser[]>`
      SELECT id, name, email, role
      FROM "User"
      WHERE id = ${id}
      LIMIT 1
    `;
    const user = rows[0];
    if (!user) return null;
    const role = String((user as any).role || 'USER').toUpperCase() as AuthUser['role'];
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role,
    };
  }

  private getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (secret) return secret;
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET is missing');
    }
    return 'dev-secret-change-me';
  }

  private async ensureSchema() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "User" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'USER',
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"(email)
    `);

    const columns = await this.prisma.$queryRaw<{ name: string }[]>`
      PRAGMA table_info('User')
    `;
    const hasRole = columns.some((col) => col.name === 'role');
    if (!hasRole) {
      await this.prisma.$executeRawUnsafe(`
        ALTER TABLE "User" ADD COLUMN role TEXT NOT NULL DEFAULT 'USER'
      `);
    }
  }

  private async ensureSeedUsers() {
    const defaultPassword = process.env.TEST_USERS_PASSWORD || 'Tekronyx@123';

    for (const user of SEED_USERS) {
      const email = user.email.toLowerCase();
      const existing = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "User" WHERE email = ${email} LIMIT 1
      `;
      const passwordHash = hashPassword(defaultPassword);
      if (!existing.length) {
        await this.prisma.$executeRaw`
          INSERT INTO "User" (id, name, email, passwordHash, role, createdAt, updatedAt)
          VALUES (${randomUUID()}, ${user.name}, ${email}, ${passwordHash}, ${user.role}, datetime('now'), datetime('now'))
        `;
      } else {
        await this.prisma.$executeRaw`
          UPDATE "User"
          SET name = ${user.name}, role = ${user.role}, updatedAt = datetime('now')
          WHERE email = ${email}
        `;
      }
    }
  }
}
