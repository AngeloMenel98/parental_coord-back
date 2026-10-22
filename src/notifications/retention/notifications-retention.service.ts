import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationRepository } from '../repositories/notification.repository';
import {
  DEFAULT_NOTIFICATIONS_RETENTION_DAYS,
  MS_PER_DAY,
} from './notifications-retention.constants';

/** Resultado de una pasada de purga (para logs/observabilidad). */
export interface NotificationsRetentionResult {
  /** Filas de notificación purgadas (leídas y no leídas). */
  purged: number;
  /** Corte usado (`now - NOTIFICATIONS_RETENTION_DAYS`). */
  cutoff: Date;
  /** Ventana aplicada, en días. */
  days: number;
}

/**
 * Retención de notificaciones (spec "Retention policy", ruling #1553, design D8).
 *
 * Corre en el worker una vez al día vía
 * `upsertJobScheduler('notifications-retention')`: borra TODAS las
 * notificaciones más antiguas que la ventana configurada
 * (`NOTIFICATIONS_RETENTION_DAYS`, por defecto 30 días) y registra el recuento.
 *
 * Política vigente = opción (i) del ruling #1553: se purgan LEÍDAS Y NO LEÍDAS
 * por igual — una notificación NO LEÍDA que envejezca más allá de la ventana
 * TAMBIÉN se elimina (consecuencia aceptada explícitamente en la spec). Por eso
 * aquí NO se pasa `onlyRead` a `purgeOlderThan`.
 *
 * La política (ii) ("las leídas a N días, las no leídas a M días") o la (iii)
 * ("las no leídas nunca se borran") NO requieren reescribir este servicio: son
 * un cambio de configuración (la ventana) MÁS una SEGUNDA llamada a
 * `purgeOlderThan` con OTRO corte (por ejemplo `purgeOlderThan(cutoffUnread, {
 * onlyRead: false })`). El repositorio ya expone el `options.onlyRead` para
 * eso; este servicio sólo resuelve el corte/política y registra el recuento.
 *
 * `source_event_id` es irrelevante para la retención: en esta slice la columna
 * es NULL en todas las filas (nadie la escribe todavía) ⇒ no puede cambiar el
 * resultado del borrado. El criterio es exclusivamente TEMPORAL.
 *
 * El SQL vive en `NotificationRepository.purgeOlderThan` (regla de casa: los
 * servicios nunca tocan TypeORM). Los errores NO se silencian aquí: los captura
 * y registra el processor (design D7).
 */
@Injectable()
export class NotificationsRetentionService {
  private readonly logger = new Logger(NotificationsRetentionService.name);

  constructor(
    private readonly notifications: NotificationRepository,
    private readonly config: ConfigService,
  ) {}

  /** Purga todo lo anterior a la ventana de retención configurada. */
  async run(now: Date = new Date()): Promise<NotificationsRetentionResult> {
    const days =
      this.config.get<number>('NOTIFICATIONS_RETENTION_DAYS') ??
      DEFAULT_NOTIFICATIONS_RETENTION_DAYS;
    const cutoff = new Date(now.getTime() - days * MS_PER_DAY);

    const purged = await this.notifications.purgeOlderThan(cutoff);

    this.logger.log(
      `notification retention: purged ${purged} rows older than ${cutoff.toISOString()} (${days}d)`,
    );

    return { purged, cutoff, days };
  }
}
