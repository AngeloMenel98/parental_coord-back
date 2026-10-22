import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

/**
 * Cuerpo de `POST /bonds/:bondId/webhooks/subscriptions` (REQ-SUB-1, AC-1).
 *
 * `url` es HTTPS-only (REQ-SEC-1); el servicio vuelve a comprobar el protocolo
 * porque `@IsUrl` sólo valida la forma. `eventTypes` acepta tipos específicos,
 * el catch-all virtual o `*`; el servicio valida cada entrada contra el catálogo.
 */
export class CreateWebhookSubscriptionDto {
  @ApiProperty({ example: 'https://receiver.example/hooks/agenda', format: 'uri' })
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  url!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['activity.done', 'activity.overdue'],
    description: 'Specific event types, the synthesized catch-all, or "*". Defaults to ["*"].',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  eventTypes?: string[];

  @ApiPropertyOptional({ maxLength: 255, example: 'Calendar sync' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
