import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { hashPassword } from '../src/auth/password.util';

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = process.env.TEST_USERS_PASSWORD || 'Tekronyx@123';

const users = [
  { name: 'Wasamy Omar', email: 'wasamy.omar@tekronyx.com' },
  { name: 'Mostafa', email: 'mostafa@tekronyx.com' },
  { name: 'Khaled', email: 'khaled@tekronyx.com' },
];

async function ensureSchema() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "User" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"(email)
  `);
}

async function main() {
  await ensureSchema();

  for (const user of users) {
    const email = user.email.toLowerCase();
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE email = ${email} LIMIT 1
    `;
    if (existing.length) continue;

    const passwordHash = hashPassword(DEFAULT_PASSWORD);
    await prisma.$executeRaw`
      INSERT INTO "User" (id, name, email, passwordHash, createdAt, updatedAt)
      VALUES (${randomUUID()}, ${user.name}, ${email}, ${passwordHash}, datetime('now'), datetime('now'))
    `;
  }
}

main()
  .catch((err) => {
    console.error('Seed failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
