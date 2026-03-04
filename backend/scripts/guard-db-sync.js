#!/usr/bin/env node

const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
const dbUrl = String(process.env.DATABASE_URL || '').trim();
const allow = String(process.env.ALLOW_DB_PUSH || '').trim().toLowerCase() === 'true';

if (allow) {
  process.exit(0);
}

if (nodeEnv === 'production' || nodeEnv === 'staging') {
  console.error('Refusing to run prisma db push in production-like NODE_ENV. Use prisma migrate deploy.');
  process.exit(1);
}

const lowerUrl = dbUrl.toLowerCase();
const looksRemote =
  lowerUrl.startsWith('postgres://') ||
  lowerUrl.startsWith('postgresql://') ||
  lowerUrl.startsWith('mysql://') ||
  lowerUrl.startsWith('sqlserver://') ||
  lowerUrl.startsWith('mongodb://') ||
  lowerUrl.startsWith('mongodb+srv://');

if (looksRemote) {
  console.error('Refusing to run prisma db push against a remote database URL. Use migrations instead.');
  process.exit(1);
}

process.exit(0);
