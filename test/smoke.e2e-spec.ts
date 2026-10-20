import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import * as request from 'supertest';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AppModule } from '../src/app.module';

/**
 * SMOKE E2E contra Postgres REAL (DB aislada `parental_coordination_test`).
 *
 * POR QUÉ EXISTE — los 3 bugs que este test habría cazado el 2026-10-20:
 *   1. `activity.category_id` no lo creaba NINGUNA migración (el entity lo exige)
 *      → `POST /activities/:bondId/create` reventaba.
 *   2. El enum `system_role` era ('progenitor','admin') pero el código escribe
 *      'user' → `POST /auth/register` devolvía 500.
 *   3. El front requería `bondActive`, que el backend no manda en compliance.
 *
 * Los e2e existentes NO los vieron: `app.e2e-spec` sólo prueba `/health` con un
 * assert tolerante (200 O 503), y `realtime`/`webhooks` mockean con `useValue`
 * y nunca tocan el schema. Este test EJERCE EL CAMINO DE ESCRITURA REAL sin
 * tolerancias: si el schema o un enum se rompen, falla aquí.
 *
 * Aislamiento: corre con `ENV_FILE=.env.test` (script `pnpm test:e2e:smoke`),
 * usa la base `parental_coordination_test` y NUNCA toca la de dev. Los datos son
 * únicos por corrida (sufijo `Date.now()`), así que es re-ejecutable sin limpiar.
 */
describe('Smoke (e2e) — flujo real sobre Postgres', () => {
  let app: INestApplication;
  const run = Date.now();

  // ── Datos únicos por corrida ────────────────────────────────────────────
  const userA = { email: `smoke-a-${run}@test.dev`, password: 'password123', firstName: 'Ana', lastName: 'Smoke' };
  const userB = { email: `smoke-b-${run}@test.dev`, password: 'password123', firstName: 'Beto', lastName: 'Smoke' };
  const admin = { email: 'admin@admin.com', password: 'admin123' };

  let tokenA = '';
  let tokenB = '';
  let adminToken = '';
  let idA = '';
  let idB = '';
  let bondId = '';
  let childId = '';
  let categoryId = '';
  let activityId = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APP_GUARD)
      .useClass(ThrottlerGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());

  it('B.1 — register + login devuelve access_token y user.id (caza el enum system_role)', async () => {
    const regA = await server().post('/api/auth/register').send(userA).expect(201);
    expect(regA.body).toHaveProperty('access_token');
    idA = regA.body.user.id;
    expect(idA).toBeTruthy();

    await server().post('/api/auth/register').send(userB).expect(201);

    const loginA = await server().post('/api/auth/login').send({ email: userA.email, password: userA.password }).expect(201);
    tokenA = loginA.body.access_token;
    idA = loginA.body.user.id;
    expect(loginA.body.user.systemRole).toBe('user');

    const loginB = await server().post('/api/auth/login').send({ email: userB.email, password: userB.password }).expect(201);
    tokenB = loginB.body.access_token;
    idB = loginB.body.user.id;

    await server().get('/api/auth/me').set('Authorization', `Bearer ${tokenA}`).expect(200);
  });

  it('B.2 — admin crea el vínculo con los dos progenitores', async () => {
    const loginAdmin = await server().post('/api/auth/login').send(admin).expect(201);
    adminToken = loginAdmin.body.access_token;

    const bond = await server()
      .post('/api/admin/bonds')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: `Smoke Bond ${run}`, agreementType: 'informal', userIds: [idA, idB] })
      .expect(201);
    bondId = bond.body.id;
    expect(bondId).toBeTruthy();
  });

  it('B.3 — admin agrega un hijo y el miembro ve el vínculo en GET /bonds', async () => {
    const child = await server()
      .post(`/api/admin/bonds/${bondId}/children`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Hijo', lastName: `Smoke ${run}` })
      .expect(201);
    childId = child.body.id;
    expect(childId).toBeTruthy();

    const bonds = await server().get('/api/bonds').set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(Array.isArray(bonds.body)).toBe(true);
    expect(bonds.body.some((b: { id: string }) => b.id === bondId)).toBe(true);
  });

  it('B.4 — GET /categories devuelve las categorías semilla', async () => {
    const cats = await server().get('/api/categories').set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(Array.isArray(cats.body)).toBe(true);
    expect(cats.body.length).toBeGreaterThan(0);
    categoryId = cats.body[0].id;
    expect(categoryId).toBeTruthy();
  });

  it('B.5 — crea la actividad con categoryId y assignedTo (caza la FK category_id)', async () => {
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const created = await server()
      .post(`/api/activities/${bondId}/create`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: `Smoke actividad ${run}`,
        categoryId,
        scheduledStart: start,
        childrenIds: [childId],
        assignedTo: idA,
      })
      .expect(201);

    activityId = created.body.id;
    expect(activityId).toBeTruthy();
    expect(created.body.categoryId).toBe(categoryId);
  });

  it('B.6 — el assignee confirma la actividad (transición canónica T5)', async () => {
    // `confirm` va con @HttpCode(200); `create` con 201 (ver activities.controller).
    const confirmed = await server()
      .post(`/api/activities/${activityId}/confirm`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(confirmed.body.assignedConfirmed).toBe(true);
  });

  it('B.7 — GET compliance y GET activities/bond responden 200 con datos del vínculo', async () => {
    const compliance = await server()
      .get(`/api/activities/${bondId}/compliance`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(compliance.body.bondId).toBe(bondId);
    expect(Array.isArray(compliance.body.members)).toBe(true);

    const list = await server()
      .get(`/api/activities/bond/${bondId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.some((a: { id: string }) => a.id === activityId)).toBe(true);
  });

  it('B.8 — GET /health reporta DB ok (sin tolerancia a 503)', async () => {
    const health = await server().get('/api/health').expect(200);
    expect(health.body).toHaveProperty('status', 'ok');
    expect(health.body).toHaveProperty('db', 'ok');
  });
});
