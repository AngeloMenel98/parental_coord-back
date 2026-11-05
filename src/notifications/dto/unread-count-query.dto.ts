import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * Query de `GET /api/notifications/unread-count`.
 *
 * `bondId` es opcional: sin él se cuentan todas las no leídas del usuario; con él,
 * sólo las de ese bond (las notificaciones sin bond —`bond_id IS NULL`— quedan
 * fuera, igual que en el resto del read path).
 *
 * La ruta se ata como DTO (no como primitivo de primer nivel) para que los query
 * params DESCONOCIDOS se rechacen con **400**, igual que `GET /api/notifications`
 * y `PATCH /api/notifications/read-all`. Atado a un primitivo, un `bondId`
 * mal escrito se ignoraría en silencio y la ruta devolvería el conteo GLOBAL
 * con un 200 (respuesta correcta a una pregunta equivocada).
 */
export class UnreadCountQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  bondId?: string;
}
