import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth + RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.TEST_USERS_PASSWORD = process.env.TEST_USERS_PASSWORD || 'Tekronyx@123';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated /api/auth/me', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('creates session on login, returns current user, and clears session on logout', async () => {
    const client = request.agent(app.getHttpServer());
    const password = process.env.TEST_USERS_PASSWORD || 'Tekronyx@123';

    const login = await client
      .post('/api/auth/login')
      .send({ email: 'mostafa@tekronyx.com', password })
      .expect(201);

    expect(login.body?.tokenType).toBe('Bearer');
    expect(typeof login.body?.token).toBe('string');
    expect(login.body?.user?.role).toBe('USER');
    expect(login.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('tekronyx_token=')]),
    );

    const me = await client.get('/api/auth/me').expect(200);
    expect(me.body?.user?.email).toBe('mostafa@tekronyx.com');
    expect(me.body?.user?.role).toBe('USER');

    const logout = await client.post('/api/auth/logout').expect(201);
    expect(logout.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('tekronyx_token=;')]),
    );

    await client.get('/api/auth/me').expect(401);
  });

  it('blocks USER role from dashboard and manager/admin-only control-kb endpoints', async () => {
    const client = request.agent(app.getHttpServer());
    const password = process.env.TEST_USERS_PASSWORD || 'Tekronyx@123';

    await client
      .post('/api/auth/login')
      .send({ email: 'mostafa@tekronyx.com', password })
      .expect(201);

    await client.get('/api/dashboard').expect(403);
    await client.get('/api/control-kb/topics').expect(403);
  });

  it('keeps MANAGER session role available via /api/auth/me', async () => {
    const client = request.agent(app.getHttpServer());
    const password = process.env.TEST_USERS_PASSWORD || 'Tekronyx@123';

    await client
      .post('/api/auth/login')
      .send({ email: 'wasamy.omar@tekronyx.com', password })
      .expect(201);

    const me = await client.get('/api/auth/me').expect(200);
    expect(me.body?.user?.role).toBe('MANAGER');
    expect(me.body?.user?.email).toBe('wasamy.omar@tekronyx.com');
  });

  it('enforces RBAC and idempotency for evidence quality recompute endpoint', async () => {
    const password = process.env.TEST_USERS_PASSWORD || 'Tekronyx@123';
    const evidence = await prisma.evidence.create({
      data: {
        title: 'E2E quality evidence',
        type: 'POLICY',
        source: 'upload',
        createdById: 'seed-user',
        status: 'ACCEPTED',
        reviewComment: 'reviewed',
      },
    });

    const userClient = request.agent(app.getHttpServer());
    await userClient
      .post('/api/auth/login')
      .send({ email: 'mostafa@tekronyx.com', password })
      .expect(201);

    await userClient
      .post(`/api/evidence/${evidence.id}/quality/recompute`)
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'rbac-test' })
      .expect(403);

    const managerClient = request.agent(app.getHttpServer());
    await managerClient
      .post('/api/auth/login')
      .send({ email: 'wasamy.omar@tekronyx.com', password })
      .expect(201);

    const key = `idem-${randomUUID()}`;
    const first = await managerClient
      .post(`/api/evidence/${evidence.id}/quality/recompute`)
      .set('Idempotency-Key', key)
      .send({ reason: 'idempotency-test' })
      .expect(201);
    expect(first.body?.ok).toBe(true);
    expect(first.body?.replayed).toBe(false);
    expect(typeof first.body?.quality?.score).toBe('number');

    const second = await managerClient
      .post(`/api/evidence/${evidence.id}/quality/recompute`)
      .set('Idempotency-Key', key)
      .send({ reason: 'idempotency-test' })
      .expect(201);
    expect(second.body?.ok).toBe(true);
    expect(second.body?.replayed).toBe(true);
    expect(second.body?.quality?.score).toBe(first.body?.quality?.score);

    const auditCount = await prisma.auditEvent.count({
      where: {
        actionType: 'EVIDENCE_QUALITY_RECOMPUTE',
        entityType: 'Evidence',
        entityId: evidence.id,
      },
    });
    expect(auditCount).toBe(1);
  });
});
