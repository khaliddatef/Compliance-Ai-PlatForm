import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as path from 'path';

const runtimeRoot = path.resolve(__dirname, '..', '..');
const backendRoot =
  path.basename(runtimeRoot).toLowerCase() === 'dist'
    ? path.resolve(runtimeRoot, '..')
    : runtimeRoot;

const toSqliteFileUrl = (absolutePath: string) => {
  const normalized = absolutePath.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:${normalized}`;
  }
  return `file:${normalized}`;
};

const normalizeDatabaseUrl = (raw?: string) => {
  const source = String(raw || 'file:./dev.db').trim().replace(/^['"]|['"]$/g, '');

  if (!source.startsWith('file:')) {
    return source;
  }

  let filePath = source.slice('file:'.length) || './dev.db';
  if (filePath.startsWith('//')) {
    filePath = decodeURIComponent(filePath.replace(/^\/+/, ''));
    if (!/^[A-Za-z]:[\\/]/.test(filePath)) {
      filePath = `/${filePath}`;
    }
  }

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(backendRoot, filePath);

  return toSqliteFileUrl(absolutePath);
};

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const url = normalizeDatabaseUrl(process.env.DATABASE_URL);

    super({
      adapter: new PrismaBetterSqlite3({ url }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
