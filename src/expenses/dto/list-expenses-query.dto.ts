import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { ExpenseStatus } from '../entities/expense.entity';

/** Default y tope de la página de gastos. */
export const EXPENSES_DEFAULT_LIMIT = 20;
export const EXPENSES_MAX_LIMIT = 100;

/**
 * Query de `GET /expenses/bond/:bondId`.
 *
 * `enableImplicitConversion:false` (app.module.ts) obliga a `@Type(() => Number)`
 * en `limit`/`offset`. Los límites son validación declarativa: el `ValidationPipe`
 * global los convierte en **400**.
 *
 * `forbidNonWhitelisted` rechaza cualquier parámetro que no esté declarado aquí.
 */
export class ListExpensesQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: EXPENSES_MAX_LIMIT,
    default: EXPENSES_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EXPENSES_MAX_LIMIT)
  limit?: number = EXPENSES_DEFAULT_LIMIT;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({ enum: ExpenseStatus })
  @IsOptional()
  @IsEnum(ExpenseStatus)
  status?: ExpenseStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-30' })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-30' })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}
