import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password.util';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
};

type AuthUserRow = AuthUser & { passwordHash: string };

const SEED_USERS: Array<{ name: string; email: string }> = [
  { name: 'Wasamy Omar', email: 'wasamy.omar@tekronyx.com' },
  { name: 'Mostafa', email: 'mostafa@tekronyx.com' },
  { name: 'Khaled', email: 'khaled@tekronyx.com' },
];

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureSchema();
    await this.ensureSeedUsers();
  }

  async validateUser(email: string, password: string): Promise<AuthUser | null> {
    const rows = await this.prisma.$queryRaw<AuthUserRow[]>`
      SELECT id, name, email, passwordHash
      FROM "User"
      WHERE email = ${email}
      LIMIT 1
    `;
    const user = rows[0];
    if (!user) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
    };
  }

  private async ensureSchema() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "User" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        passwordHash TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"(email)
    `);
  }

  private async ensureSeedUsers() {
    const defaultPassword = process.env.TEST_USERS_PASSWORD || 'Tekronyx@123';

    for (const user of SEED_USERS) {
      const email = user.email.toLowerCase();
      const existing = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "User" WHERE email = ${email} LIMIT 1
      `;
      if (existing.length) continue;

      const passwordHash = hashPassword(defaultPassword);
      await this.prisma.$executeRaw`
        INSERT INTO "User" (id, name, email, passwordHash, createdAt, updatedAt)
        VALUES (${randomUUID()}, ${user.name}, ${email}, ${passwordHash}, datetime('now'), datetime('now'))
      `;
    }
  }
}
