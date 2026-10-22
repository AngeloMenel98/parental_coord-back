import { Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { AuthUser } from '../auth/dto/auth-user.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { MarkAllReadQueryDto } from './dto/mark-all-read-query.dto';
import { UnreadCountQueryDto } from './dto/unread-count-query.dto';
import { NotificationsService } from './notifications.service';

/**
 * Read path de notificaciones (`notifications-read-path`).
 *
 * El controlador es FINO: no toca la BD ni decide el scoping — sólo valida la
 * entrada (global `ValidationPipe` + `ParseUUIDPipe`) y delega en el servicio,
 * que es quien conoce el usuario de la sesión (`@CurrentUser() user`).
 *
 * ⚠ ORDEN DE RUTAS — las rutas ESTÁTICAS se declaran ANTES que las de
 * parámetro. En Nest/Express el orden de declaración es el orden de
 * resolución: un `GET :id` declarado antes se comería `GET unread-count`
 * (y un `PATCH :id/read` antes se comería `PATCH read-all`). Precedente:
 * `src/activities/activities.controller.ts` (`GET bond/:bondId` antes de
 * `GET :id`).
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /** `GET /api/notifications` — página de notificaciones del usuario, recientes primero. */
  @Get()
  @ApiOperation({
    summary: 'List the current user notifications (newest first)',
    description:
      'Sólo las notificaciones del usuario autenticado. `limit` (1..100, def. 20), `offset` ' +
      '(>= 0, def. 0), `unreadOnly` (sólo el literal `true`/`false`) y `bondId` (opcional). ' +
      'Los parámetros fuera de rango o el `unreadOnly` inválido ⇒ 400.',
  })
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsQueryDto) {
    return this.notificationsService.list(user, query);
  }

  /**
   * `GET /api/notifications/unread-count` — nº de no leídas del usuario.
   *
   * `bondId` se ata como DTO (`@Query() query: UnreadCountQueryDto`), igual que
   * las otras dos rutas con query: así los query params DESCONOCIDOS se
   * rechazan con **400** (`forbidNonWhitelisted` del pipe global) en vez de
   * ignorarse en silencio. Atado a un primitivo, un `bondId` mal escrito
   * (`?bondid=…`) se descartaría y la ruta devolvería el conteo GLOBAL con un
   * 200 — una respuesta correcta a una pregunta equivocada. Un `bondId` mal
   * formado ⇒ 400 (lo lanza el `@IsUUID()` del DTO).
   */
  @Get('unread-count')
  @ApiOperation({
    summary: 'Count the current user unread notifications',
    description:
      'Opcionalmente acotado por `bondId` (las notificaciones sin bond quedan fuera). ' +
      'Un query param desconocido ⇒ 400.',
  })
  unreadCount(@CurrentUser() user: AuthUser, @Query() query: UnreadCountQueryDto) {
    return this.notificationsService.unreadCount(user, query.bondId);
  }

  /** `PATCH /api/notifications/read-all` — marca TODAS las no leídas del usuario como leídas. */
  @Patch('read-all')
  @ApiOperation({
    summary: 'Mark every unread notification of the current user as read',
    description:
      'Devuelve `{ affected }` = cuántas filas cambiaron (las ya leídas no cuentan). ' +
      'Con `bondId` sólo se tocan las de ese bond.',
  })
  markAllRead(@CurrentUser() user: AuthUser, @Query() query: MarkAllReadQueryDto) {
    return this.notificationsService.markAllRead(user, query.bondId);
  }

  /**
   * `PATCH /api/notifications/:id/read` — marca UNA notificación como leída.
   *
   * `ParseUUIDPipe` ⇒ 400 si el id no es un UUID; 404 si no existe o es de otro
   * usuario (mismo status para ambos: no se confirma la existencia ajena).
   */
  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark one notification of the current user as read',
    description:
      '404 si la notificación no existe o no pertenece al usuario (mismo status para ambos).',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  markRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notificationsService.markRead(user, id);
  }
}
