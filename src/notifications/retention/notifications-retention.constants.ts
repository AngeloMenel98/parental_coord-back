/**
 * Estables de la purga de retención de notificaciones (design D1/D8).
 *
 * El scheduler y el `@Processor` de esta cola viven SÓLO en el proceso worker
 * (`worker.main.ts` → `WorkerModule` → `NotificationsWorkerModule`); el API no
 * registra ni la cola ni el scheduler. Sin cron, sin `@nestjs/schedule` y sin
 * `setInterval`: el repeatable scheduler de BullMQ es el único reloj.
 */

/** Cola BullMQ de la purga de retención (sólo worker). */
export const NOTIFICATION_RETENTION_QUEUE = 'notification-retention';

/**
 * Job names que resuelve el switch por `job.name` del processor (design D7):
 * `retention` es la pasada de purga. Cualquier otro nombre se ignora con un
 * warning — la red de seguridad de un rollback (el estado de Redis sobrevive al
 * código, ver `removeJobScheduler` en el scheduler).
 */
export enum NotificationRetentionJobName {
  RETENTION = 'retention',
}

/** ID del `upsertJobScheduler` (BullMQ repeatable scheduler, no cron). */
export const NOTIFICATIONS_RETENTION_SCHEDULER_ID = 'notifications-retention';

/** Días de retención por defecto de las notificaciones (spec "Retention policy"). */
export const DEFAULT_NOTIFICATIONS_RETENTION_DAYS = 30;

/** Cadencia por defecto de la purga: una vez al día (86_400_000 ms). */
export const DEFAULT_NOTIFICATIONS_RETENTION_INTERVAL_MS = 86_400_000;

/** Milisegundos de un día, para convertir la ventana de retención en un corte. */
export const MS_PER_DAY = 86_400_000;
