import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

import { WebhookSubscriptionStatus } from '../entities/webhook-subscription.entity';

/**
 * Cuerpo de `PATCH /bonds/:bondId/webhooks/subscriptions/:id` (REQ-SUB-1/4).
 *
 * Todos los campos son opcionales; `status` sólo permite alternar entre `ACTIVE`
 * y `DISABLED` (REQ-SUB-4). `AUTO_DISABLED` es un estado del sistema, no un valor
 * asignable por el cliente.
 */
export class UpdateWebhookSubscriptionDto {
  @ApiPropertyOptional({ example: 'https://receiver.example/hooks/agenda', format: 'uri' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  url?: string;

  @ApiPropertyOptional({ type: [String], example: ['*'] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  eventTypes?: string[];

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({
    enum: [WebhookSubscriptionStatus.ACTIVE, WebhookSubscriptionStatus.DISABLED],
  })
  @IsOptional()
  @IsEnum(WebhookSubscriptionStatus)
  status?: WebhookSubscriptionStatus;
}
