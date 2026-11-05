import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';

/**
 * Vista de UNA notificación (contrato de lectura).
 *
 * Expone EXACTAMENTE los campos del contrato: nada más (el `@Exclude()` de
 * clase + `excludeExtraneousValues` en el servicio garantizan que `user_id`,
 * `bond_id` interno o cualquier otro campo no se filtre).
 */
@Exclude()
export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  @Expose()
  id!: string;

  @ApiProperty({ example: 'activity_assigned' })
  @Expose()
  type!: string;

  @ApiProperty()
  @Expose()
  title!: string;

  @ApiProperty()
  @Expose()
  body!: string;

  @ApiProperty({ example: 'activity' })
  @Expose()
  refEntityType!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Expose()
  refEntityId!: string | null;

  /** NULLABLE: hay notificaciones sin bond (`bond_id IS NULL`). */
  @ApiProperty({ format: 'uuid', nullable: true })
  @Expose()
  bondId!: string | null;

  @ApiProperty()
  @Expose()
  isRead!: boolean;

  @ApiProperty({ format: 'date-time' })
  @Expose()
  createdAt!: string;
}

/**
 * Página de notificaciones.
 *
 * `nextCursor` se expone YA (siempre `null` en este batch) para que la forma
 * no cambie cuando llegue la paginación por cursor.
 */
@Exclude()
export class PaginatedNotificationsDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  @Type(() => NotificationResponseDto)
  @Expose()
  items: NotificationResponseDto[] = [];

  @ApiProperty({
    description: 'Total de filas que casan con los filtros (no sólo las de la página).',
  })
  @Expose()
  total!: number;

  @ApiProperty()
  @Expose()
  limit!: number;

  @ApiProperty()
  @Expose()
  offset!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Cursor de la página siguiente; `null` mientras la paginación sea por offset.',
  })
  @Expose()
  nextCursor!: string | null;
}

/** Conteo de no leídas del usuario (opcionalmente acotado por `bondId`). */
@Exclude()
export class UnreadCountResponseDto {
  @ApiProperty({ description: 'Notificaciones no leídas del usuario autenticado.' })
  @Expose()
  unreadCount!: number;
}
