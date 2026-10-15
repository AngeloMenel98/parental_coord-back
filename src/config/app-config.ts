import { Type, plainToInstance } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

/**
 * Typed, validated application configuration.
 *
 * Property names match env var names verbatim (identity mapping in
 * plainToInstance) so validation errors name the actual missing var.
 */
export class AppConfig {
  @IsString()
  @IsNotEmpty()
  DB_HOST!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT!: number;

  @IsString()
  @IsNotEmpty()
  DB_USER!: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  DB_NAME!: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN?: string;

  /** Set to 'true' for managed Postgres (Supabase/Neon) that requires SSL. */
  @IsOptional()
  @IsString()
  DB_SSL?: string;

  /** Comma-separated origins for CORS (e.g. app frontend origin). */
  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsString()
  NODE_ENV?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PORT?: number;

  @IsOptional()
  @IsString()
  REDIS_HOST?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  REDIS_PORT?: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  REDIS_DB?: number;

  /** Set to 'true' for managed Redis requiring TLS. */
  @IsOptional()
  @IsString()
  REDIS_TLS?: string;

  /** Response window (hours) before an assigned activity becomes overdue. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  RESPONSE_TIMEOUT_HOURS?: number;

  // --- Webhooks (design D12) — every key optional, defaults applied here. ---

  /** Payload-only API version constant; NOT URL versioning. */
  @IsOptional()
  @IsString()
  WEBHOOK_API_VERSION?: string = '2026-10-01';

  /** Delivery logs and dispatched outbox rows are purged after N days. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  WEBHOOK_RETENTION_DAYS?: number = 30;

  /** Relay poll interval (ms) for pending outbox rows. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  WEBHOOK_POLL_INTERVAL_MS?: number = 2000;

  /** Reconciliation interval (ms) to recover jobs lost after a Redis flush. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  WEBHOOK_RECONCILE_INTERVAL_MS?: number = 300000;

  /** Hard cap of subscriptions per bond (REQ-SUB-6). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  WEBHOOK_MAX_PER_BOND?: number = 10;

  /** Process-local per-endpoint concurrency cap (REQ-DEL-5, OQ-B). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  WEBHOOK_ENDPOINT_CONCURRENCY?: number = 5;

  /** Secret rotation grace window (hours) — both signatures are sent. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  WEBHOOK_ROTATION_GRACE_HOURS?: number = 24;

  /** Sustained-failure window (days) before a subscription auto-disables. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  WEBHOOK_AUTO_DISABLE_DAYS?: number = 5;

  /** Per-request delivery timeout (ms). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  WEBHOOK_DELIVERY_TIMEOUT_MS?: number = 10000;

  /**
   * AES-256-GCM master key (base64, 32 bytes) for signing secrets at rest.
   * Optional on purpose (OQ-D): absent is a no-op until a delivery needs to
   * decrypt, which then fails lazily with a clear error.
   */
  @IsOptional()
  @IsString()
  WEBHOOK_SECRET_MASTER_KEY?: string;
}

export function validateConfig(config: Record<string, unknown>): AppConfig {
  const instance = plainToInstance(AppConfig, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(instance);
  if (errors.length > 0) {
    throw new Error(
      'Config validation failed — missing/invalid: ' +
        errors.map((error) => error.property).join(', '),
    );
  }
  return instance;
}
