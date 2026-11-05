import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * Query de `PATCH /api/notifications/read-all`.
 *
 * `bondId` es opcional: sin él se marcan todas las no leídas del usuario; con él,
 * sólo las de ese bond (las notificaciones sin bond —`bond_id IS NULL`— quedan
 * fuera, igual que en el resto del read path).
 */
export class MarkAllReadQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  bondId?: string;
}
