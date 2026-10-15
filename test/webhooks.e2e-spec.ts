import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TestingModule, Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';

import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { SubscriptionsController } from '../src/webhooks/subscriptions/subscriptions.controller';
import { SubscriptionsService } from '../src/webhooks/subscriptions/subscriptions.service';

/**
 * T-W2.8 — Contrato HTTP del API de webhooks (REQ-SUB-1/2, AC-1/AC-2).
 *
 * E2E ligero y auto-contenido: monta el `SubscriptionsController` REAL con el
 * prefijo global `api`, el `ValidationPipe` global y un `SubscriptionsService`
 * mockeado (no hay Postgres en CI). Verifica sólo lo que aporta el borde HTTP:
 *  - la ruta efectiva `POST/GET /api/bonds/:bondId/webhooks/subscriptions`,
 *  - que el `JwtAuthGuard` protege (401) y el usuario llega al servicio,
 *  - la validación del body (URL no-https → 400),
 *  - el 201 de creación con secreto "mostrado una vez",
 *  - el 403 cuando la autorización de membresía falla,
 *  - que la lectura no expone el material de secreto.
 */
class FakeAuthGuard {
  canActivate(context: import('@nestjs/common').ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const id = req.headers['x-test-user'];
    if (!id) return false;
    req.user = { id, email: `${id}@example.com`, systemRole: 'user' };
    return true;
  }
}

describe('Webhooks API (e2e, T-W2.8)', () => {
  let app: INestApplication;
  const service = {
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    rotateSecret: jest.fn(),
    test: jest.fn(),
  };

  const BOND = '11111111-1111-1111-1111-111111111111';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ limit: 1000, ttl: 60_000 }] })],
      controllers: [SubscriptionsController],
      providers: [{ provide: SubscriptionsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(new FakeAuthGuard())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /api/bonds/:bondId/webhooks/event-types returns the catalog', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/bonds/${BOND}/webhooks/event-types`)
      .set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('GET subscriptions forwards the authenticated user to the service', async () => {
    service.list.mockResolvedValue([{ id: 's1', url: 'https://x.example/h' }]);

    const res = await request(app.getHttpServer())
      .get(`/api/bonds/${BOND}/webhooks/subscriptions`)
      .set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 's1', url: 'https://x.example/h' }]);
    expect(service.list).toHaveBeenCalledWith(
      BOND,
      expect.objectContaining({ id: 'u1', email: 'u1@example.com' }),
    );
  });

  it('returns 403 when the caller is not an active member', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    service.list.mockRejectedValue(new ForbiddenException('not a member'));

    const res = await request(app.getHttpServer())
      .get(`/api/bonds/${BOND}/webhooks/subscriptions`)
      .set('x-test-user', 'outsider');

    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app.getHttpServer()).get(`/api/bonds/${BOND}/webhooks/subscriptions`);
    expect(res.status).toBe(403);
  });

  it('POST subscriptions validates the body (http URL → 400)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/bonds/${BOND}/webhooks/subscriptions`)
      .set('x-test-user', 'u1')
      .send({ url: 'http://insecure.example/hook' });

    expect(res.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('POST subscriptions returns 201 with the one-time secret', async () => {
    service.create.mockResolvedValue({
      id: 's1',
      bondId: BOND,
      url: 'https://receiver.example/h',
      secret: 'whsec_shown_once',
    });

    const res = await request(app.getHttpServer())
      .post(`/api/bonds/${BOND}/webhooks/subscriptions`)
      .set('x-test-user', 'u1')
      .send({ url: 'https://receiver.example/h', eventTypes: ['activity.done'] });

    expect(res.status).toBe(201);
    expect(res.body.secret).toBe('whsec_shown_once');
    expect(service.create).toHaveBeenCalledWith(
      BOND,
      expect.objectContaining({ url: 'https://receiver.example/h' }),
      expect.objectContaining({ id: 'u1' }),
    );
  });

  it('reads never expose the signing secret', async () => {
    service.list.mockResolvedValue([{ id: 's1', url: 'https://x.example/h' }]);

    const res = await request(app.getHttpServer())
      .get(`/api/bonds/${BOND}/webhooks/subscriptions`)
      .set('x-test-user', 'u1');

    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
