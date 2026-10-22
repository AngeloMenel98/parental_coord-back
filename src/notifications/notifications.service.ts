import { Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { AuthUser } from '../auth/dto/auth-user.dto';
import { NotificationEntity } from './entities/notification.entity';
import {
  ListNotificationsQueryDto,
  NOTIFICATIONS_DEFAULT_LIMIT,
} from './dto/list-notifications-query.dto';
import {
  NotificationResponseDto,
  PaginatedNotificationsDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto';
import { NotificationRepository } from './repositories/notification.repository';

/** Respuesta de `PATCH /api/notifications/:id/read`. */
export interface MarkReadResponse {
  id: string;
  isRead: true;
}

/** Respuesta de `PATCH /api/notifications/read-all`. */
export interface MarkAllReadResponse {
  affected: number;
}

/**
 * Orquestación del read path de notificaciones (notifications-read-path).
 *
 * El servicio es el dueño del SCOPING: ninguna consulta acepta un `userId` del
 * cliente — siempre sale de la sesión (`user.id`). El repositorio aplica el
 * `WHERE user_id = :userId` como primera condición; aquí se traduce el
 * resultado a los DTOs de respuesta.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly notifications: NotificationRepository) {}

  /**
   * Página de notificaciones del usuario, más recientes primero.
   *
   * `nextCursor` se expone siempre (valor `null` en este batch) para que la
   * forma de la respuesta no cambie al llegar la paginación por cursor.
   */
  async list(user: AuthUser, query: ListNotificationsQueryDto): Promise<PaginatedNotificationsDto> {
    const limit = query.limit ?? NOTIFICATIONS_DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const { items, total } = await this.notifications.listForUser(user.id, {
      limit,
      offset,
      unreadOnly: query.unreadOnly,
      bondId: query.bondId,
    });

    return plainToInstance(
      PaginatedNotificationsDto,
      {
        items: items.map((row) => this.toResponse(row)),
        total,
        limit,
        offset,
        nextCursor: null,
      },
      { excludeExtraneousValues: true },
    );
  }

  /** Nº de notificaciones no leídas del usuario (opcionalmente acotado por bond). */
  async unreadCount(user: AuthUser, bondId?: string): Promise<UnreadCountResponseDto> {
    const unreadCount = await this.notifications.countUnread(user.id, bondId);

    return plainToInstance(
      UnreadCountResponseDto,
      { unreadCount },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Marca UNA notificación como leída.
   *
   * `affected === 0` ⇒ no existe o es de otro usuario ⇒ **404** (nunca 403:
   * un 403 confirmaría que el id existe, filtrando existencia ajena).
   */
  async markRead(user: AuthUser, id: string): Promise<MarkReadResponse> {
    const affected = await this.notifications.markRead(id, user.id);

    if (affected === 0) {
      throw new NotFoundException(`Notification "${id}" not found`);
    }

    return { id, isRead: true };
  }

  /** Marca todas las no leídas del usuario como leídas y devuelve cuántas cambiaron. */
  async markAllRead(user: AuthUser, bondId?: string): Promise<MarkAllReadResponse> {
    const affected = await this.notifications.markAllRead(user.id, bondId);
    return { affected };
  }

  /** Mapeo entidad → DTO: `createdAt` sale como ISO-8601 y los nulos se normalizan. */
  private toResponse(row: NotificationEntity): NotificationResponseDto {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      refEntityType: row.refEntityType,
      refEntityId: row.refEntityId ?? null,
      bondId: row.bondId ?? null,
      isRead: row.isRead,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
