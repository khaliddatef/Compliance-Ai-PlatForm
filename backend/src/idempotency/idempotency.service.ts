import { BadRequestException, ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

type ExecuteWithIdempotencyParams<T> = {
  key: string;
  actorId: string;
  actionType: string;
  payload: unknown;
  handler: () => Promise<T>;
};

@Injectable()
export class IdempotencyService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  assertKey(key: string | undefined | null) {
    const value = String(key || '').trim();
    if (!value) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return value;
  }

  async execute<T>(params: ExecuteWithIdempotencyParams<T>) {
    const key = this.assertKey(params.key);
    const actorId = String(params.actorId || '').trim();
    if (!actorId) {
      throw new BadRequestException('actorId is required for idempotent operations');
    }

    const actionType = String(params.actionType || '').trim().toUpperCase();
    const payloadHash = this.hashPayload(params.payload);
    const existing = await this.prisma.$queryRaw<any[]>`
      SELECT id, requestHash, responseJson
      FROM "IdempotencyRecord"
      WHERE key = ${key} AND actorId = ${actorId} AND actionType = ${actionType}
      LIMIT 1
    `;
    const row = existing[0];
    if (row) {
      if (row.requestHash !== payloadHash) {
        throw new ConflictException('Idempotency key already used with a different payload');
      }
      return {
        replayed: true,
        value: this.tryParseJson(row.responseJson) as T,
      };
    }

    const value = await params.handler();
    await this.prisma.$executeRaw`
      INSERT INTO "IdempotencyRecord" (
        id,
        key,
        actorId,
        actionType,
        requestHash,
        responseJson,
        createdAt
      ) VALUES (
        ${randomUUID()},
        ${key},
        ${actorId},
        ${actionType},
        ${payloadHash},
        ${this.safeJson(value)},
        datetime('now')
      )
    `;

    return {
      replayed: false,
      value,
    };
  }

  private hashPayload(payload: unknown) {
    const source = this.safeJson(payload);
    return createHash('sha256').update(source).digest('hex');
  }

  private safeJson(value: unknown) {
    try {
      return JSON.stringify(value);
    } catch {
      return JSON.stringify({ fallback: String(value) });
    }
  }

  private tryParseJson(value: unknown) {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private async ensureSchema() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        actorId TEXT NOT NULL,
        actionType TEXT NOT NULL,
        requestHash TEXT NOT NULL,
        responseJson TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        expiresAt TEXT
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyRecord_key_actor_action_key"
      ON "IdempotencyRecord"(key, actorId, actionType)
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "IdempotencyRecord_createdAt_idx"
      ON "IdempotencyRecord"(createdAt)
    `);
  }
}

