import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as path from 'path';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const url = PrismaService.resolveDatabaseUrl(process.env.DATABASE_URL);

    super({
      adapter: new PrismaBetterSqlite3({ url }),
    });
  }

  private static resolveDatabaseUrl(rawUrl?: string) {
    const fallback = 'file:./dev.db';
    const source = String(rawUrl || fallback).trim();

    if (!source.startsWith('file:')) {
      return source;
    }

    const filePath = source.slice('file:'.length).replace(/^['"]|['"]$/g, '');
    if (!filePath) {
      return fallback;
    }

    if (path.isAbsolute(filePath)) {
      return `file:${filePath.replace(/\\/g, '/')}`;
    }

    const backendRoot = PrismaService.resolveBackendRoot();
    const absolutePath = path.resolve(backendRoot, filePath);
    return `file:${absolutePath.replace(/\\/g, '/')}`;
  }

  private static resolveBackendRoot() {
    // In watch/prod builds __dirname can be ".../backend/dist/src/prisma",
    // while in ts-node it can be ".../backend/src/prisma". Normalize both to ".../backend".
    let root = path.resolve(__dirname, '..', '..');
    const base = path.basename(root).toLowerCase();
    if (base === 'dist' || base === 'src') {
      root = path.dirname(root);
    }
    return root;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
