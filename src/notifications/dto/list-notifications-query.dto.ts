import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Default y tope de la página de notificaciones (read path, batch 1). */
export const NOTIFICATIONS_DEFAULT_LIMIT = 20;
export const NOTIFICATIONS_MAX_LIMIT = 100;

/**
 * Query de `GET /api/notifications`.
 *
 * `enableImplicitConversion:false` (app.module.ts) obliga a `@Type(() => Number)`
 * en `limit`/`offset`. Los límites son VALIDACIÓN DECLARATIVA: los recoge el
 * `ValidationPipe` global y los convierte en **400** (nunca 422 — `CodedException`
 * es exclusivo del namespace de activities y `UnprocessableEntityException` no
 * existe en este repo).
 */
export class ListNotificationsQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: NOTIFICATIONS_MAX_LIMIT,
    default: NOTIFICATIONS_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATIONS_MAX_LIMIT)
  limit?: number = NOTIFICATIONS_DEFAULT_LIMIT;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  /**
   * Filtro estricto: sólo el literal `true`/`false` (sin distinguir mayúsculas).
   *
   * ⚠ El `@Transform` DEBE lanzar `BadRequestException` (una `HttpException`), NUNCA
   * un `Error` plano: `ValidationPipe.transform()` invoca `plainToClass()` SIN
   * try/catch (`@nestjs/common/pipes/validation.pipe.js`), de modo que un `Error`
   * plano escapa como no-`HttpException` y el filtro de excepciones lo devuelve como
   * **500** en lugar de **400**.
   *
   * El `@Transform` es imprescindible: la coerción laxa del pipe
   * (`transformPrimitive`, `'true' → true` y cualquier otra cosa → `false`) sólo
   * aplica a primitivos TOP-LEVEL de `query`/`param`, nunca a propiedades de un DTO.
   */
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Sólo el literal `true`/`false` (case-insensitive); cualquier otro valor ⇒ 400.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    throw new BadRequestException('unreadOnly must be either "true" or "false"');
  })
  @IsBoolean()
  unreadOnly?: boolean;

  /**
   * Filtro por bond. `notification.bond_id` es NULLABLE: sin `bondId` las
   * notificaciones SIN bond se incluyen; con `bondId` quedan excluidas.
   */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  bondId?: string;
}
