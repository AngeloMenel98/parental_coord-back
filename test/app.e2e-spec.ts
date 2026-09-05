import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AppModule } from '../src/app.module';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APP_GUARD)
      .useClass(ThrottlerGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns 200 or 503 (depends on DB availability)', async () => {
    // The health endpoint requires a database connection.
    // With DB: returns 200 { status: 'ok', db: 'ok' }
    // Without DB: returns 503 { status: 'error', db: 'down' }
    const response = await request(app.getHttpServer()).get('/api/health');

    expect([200, 503]).toContain(response.status);
    expect(response.body).toHaveProperty('status');

    if (response.status === 200) {
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('db', 'ok');
    } else {
      expect(response.body).toHaveProperty('status', 'error');
      expect(response.body).toHaveProperty('db', 'down');
    }
  });
});
