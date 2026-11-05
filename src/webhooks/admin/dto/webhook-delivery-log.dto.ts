import { ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Default y tope de la página del log de entregas (REQ-LOG-1). */
export const WEBHOOK_DELIVERY_LOG_DEFAULT_LIMIT = 20;
export const WEBHOOK_DELIVERY_LOG_MAX_LIMIT = 100;

/**
 * Query de `GET /bonds/:bondId/webhooks/subscriptions/:id/deliveries`
 * (REQ-LOG-1). `enableImplicitConversion:false` obliga a `@Type(() => Number)`.
 */
export class WebhookDeliveryLogQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: WEBHOOK_DELIVERY_LOG_MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WEBHOOK_DELIVERY_LOG_MAX_LIMIT)
  limit?: number = WEBHOOK_DELIVERY_LOG_DEFAULT_LIMIT;
}

/** Un intento dentro del log (REQ-LOG-1). */
@Exclude()
export class WebhookDeliveryAttemptResponseDto {
  @Expose() attemptNo!: number;
  @Expose() statusCode!: number | null;
  @Expose() durationMs!: number | null;
  /** Truncado a ≤1 KB y NO confiable (REQ-SEC-5). */
  @Expose() responseSnippet!: string | null;
  @Expose() error!: string | null;
  @Expose() startedAt!: string;
}

/** Una entrega con sus intentos (REQ-LOG-1, AC-16). */
@Exclude()
export class WebhookDeliveryResponseDto {
  @Expose() id!: string;
  @Expose() eventId!: string;
  @Expose() subscriptionId!: string;
  @Expose() status!: string;
  @Expose() attemptCount!: number;
  @Expose() nextAttemptAt!: string | null;
  @Expose() lastStatusCode!: number | null;
  @Expose() lastError!: string | null;
  @Expose() createdAt!: string;
  @Expose() completedAt!: string | null;

  @Expose()
  @Type(() => WebhookDeliveryAttemptResponseDto)
  attempts: WebhookDeliveryAttemptResponseDto[] = [];
}

/** Página del log (REQ-LOG-1). */
@Exclude()
export class PaginatedWebhookDeliveriesDto {
  @Expose()
  @Type(() => WebhookDeliveryResponseDto)
  data: WebhookDeliveryResponseDto[] = [];

  @Expose() page!: number;
  @Expose() limit!: number;
  @Expose() total!: number;
}
