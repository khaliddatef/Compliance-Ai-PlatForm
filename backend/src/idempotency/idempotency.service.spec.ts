import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService', () => {
  const hash = (payload: unknown) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

  const createService = () => {
    const prisma = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      $executeRawUnsafe: jest.fn(),
    };
    const service = new IdempotencyService(prisma as any);
    return { service, prisma };
  };

  it('requires idempotency key', () => {
    const { service } = createService();
    expect(() => service.assertKey('')).toThrow('Idempotency-Key header is required');
  });

  it('returns replayed response when key/payload already exists', async () => {
    const { service, prisma } = createService();
    const payload = { controlId: 'c-1' };
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 'record-1',
        requestHash: hash(payload),
        responseJson: JSON.stringify({ ok: true, id: 'existing' }),
      },
    ]);

    const result = await service.execute({
      key: 'idem-key-1',
      actorId: 'user-1',
      actionType: 'CREATE_EVIDENCE_REQUEST',
      payload,
      handler: jest.fn().mockResolvedValue({ ok: false }),
    });

    expect(result.replayed).toBe(true);
    expect(result.value).toEqual({ ok: true, id: 'existing' });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects key reuse with different payload', async () => {
    const { service, prisma } = createService();
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 'record-1',
        requestHash: hash({ controlId: 'c-1' }),
        responseJson: JSON.stringify({ ok: true }),
      },
    ]);

    await expect(
      service.execute({
        key: 'idem-key-1',
        actorId: 'user-1',
        actionType: 'CREATE_EVIDENCE_REQUEST',
        payload: { controlId: 'c-2' },
        handler: jest.fn().mockResolvedValue({ ok: true }),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores response for first execution', async () => {
    const { service, prisma } = createService();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$executeRaw.mockResolvedValue(1);
    const handler = jest.fn().mockResolvedValue({ ok: true, created: 3 });

    const result = await service.execute({
      key: 'idem-key-new',
      actorId: 'user-9',
      actionType: 'CONTROL_REQUEST_EVIDENCE',
      payload: { controlId: 'ctrl-1' },
      handler,
    });

    expect(result.replayed).toBe(false);
    expect(result.value).toEqual({ ok: true, created: 3 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
