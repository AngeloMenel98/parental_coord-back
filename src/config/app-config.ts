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
