import 'reflect-metadata';
import { validateConfig } from './app-config';

/**
 * Tests de las adiciones de webhooks (design D12). Todas las claves son
 * `@IsOptional` con default; los enteros se coercionan desde el string de env.
 */
describe('AppConfig — webhook keys (D12)', () => {
  const required = {
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USER: 'u',
    DB_PASSWORD: 'p',
    DB_NAME: 'd',
    JWT_SECRET: 's',
  };

  it('is valid without any webhook key and applies the D12 defaults', () => {
    const cfg = validateConfig({ ...required });

    expect(cfg.WEBHOOK_API_VERSION).toBe('2026-10-01');
    expect(cfg.WEBHOOK_RETENTION_DAYS).toBe(30);
    expect(cfg.WEBHOOK_POLL_INTERVAL_MS).toBe(2000);
    expect(cfg.WEBHOOK_RECONCILE_INTERVAL_MS).toBe(300000);
    expect(cfg.WEBHOOK_MAX_PER_BOND).toBe(10);
    expect(cfg.WEBHOOK_ENDPOINT_CONCURRENCY).toBe(5);
    expect(cfg.WEBHOOK_ROTATION_GRACE_HOURS).toBe(24);
    expect(cfg.WEBHOOK_AUTO_DISABLE_DAYS).toBe(5);
    expect(cfg.WEBHOOK_DELIVERY_TIMEOUT_MS).toBe(10000);
    expect(cfg.WEBHOOK_SECRET_MASTER_KEY).toBeUndefined();
  });

  it('coerces env string ints to numbers', () => {
    const cfg = validateConfig({
      ...required,
      WEBHOOK_RETENTION_DAYS: '7',
      WEBHOOK_POLL_INTERVAL_MS: '500',
      WEBHOOK_MAX_PER_BOND: '3',
      WEBHOOK_SECRET_MASTER_KEY: 'base64key',
    });

    expect(cfg.WEBHOOK_RETENTION_DAYS).toBe(7);
    expect(cfg.WEBHOOK_POLL_INTERVAL_MS).toBe(500);
    expect(cfg.WEBHOOK_MAX_PER_BOND).toBe(3);
    expect(cfg.WEBHOOK_SECRET_MASTER_KEY).toBe('base64key');
  });

  it('rejects a non-integer webhook value', () => {
    expect(() => validateConfig({ ...required, WEBHOOK_MAX_PER_BOND: 'abc' })).toThrow(
      /Config validation failed/,
    );
  });
});
