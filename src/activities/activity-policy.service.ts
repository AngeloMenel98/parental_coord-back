import { Injectable } from '@nestjs/common';
import { ActivityStatus } from './entities/activity.entity';

/** Ventana de deshacer, en milisegundos. La posee el SERVIDOR ([isWithinUndoWindow]). */
export const UNDO_WINDOW_MS = 5000;

/**
 * Los campos que la política necesita. Deliberadamente un tipo estructural y no
 * `ActivityEntity`: la política es PURA y no toca la base de datos, así que se
 * puede ejercitar sin TypeORM y sin contenedor.
 */
/**
 * De dónde llegó una actividad a `overdue` (T8).
 *
 * UNA sola definición para sus dos consumidores: la política (¿se puede aceptar
 * tarde?) y el guard del servicio (¿la transición es válida?). Dos copias de
 * esta regla es una forma garantizada de que se desincronicen.
 *
 * - `created`: nunca tuvo asignado (`assigned_to IS NULL`).
 * - `verify`: pasó por la ventana de verificación (`verify_at IS NOT NULL`).
 * - `assigned`: venció esperando una aceptación.
 */
export type OverdueOrigin = 'created' | 'assigned' | 'verify';

export function overdueOrigin(subject: {
  assignedTo: string | null;
  verifyAt: Date | null;
}): OverdueOrigin {
  if (subject.assignedTo == null) return 'created';
  if (subject.verifyAt != null) return 'verify';
  return 'assigned';
}

export interface PolicySubject {
  createdBy: string;
  assignedTo: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  status: ActivityStatus;
  verifyAt: Date | null;
}

export interface ActivityPolicyDecision {
  canDelete: boolean;
  canCancel: boolean;
  canConfirm: boolean;
  canDecline: boolean;
  canComplete: boolean;
  isPast: boolean;
}

@Injectable()
export class ActivityPolicyService {
  isPast(activity: PolicySubject, now: Date): boolean {
    const anchor = activity.scheduledEnd ?? activity.scheduledStart;
    return anchor != null && now >= anchor;
  }

  evaluate(activity: PolicySubject, viewerId: string, now: Date): ActivityPolicyDecision {
    const isPast = this.isPast(activity, now);
    const isCreator = activity.createdBy === viewerId;
    const isAssignee = activity.assignedTo !== null && activity.assignedTo === viewerId;

    // Origin rule (T8): la aceptación tardía existe SÓLO cuando el `overdue`
    // viene de `assigned`. La origen la define `overdueOrigin()` — la misma
    // función que usa el guard del servicio.
    const origin = overdueOrigin(activity);
    const canRespond =
      isAssignee &&
      (activity.status === ActivityStatus.ASSIGNED ||
        (activity.status === ActivityStatus.OVERDUE && origin === 'assigned'));

    return {
      canDelete: isCreator && !isPast,
      canCancel: isCreator && !isPast,
      // CONFIRMAR no lleva `isPast`: confirmar una actividad YA terminada es el
      // caso normal — la ventana de verificación existe justo para eso — y es lo
      // que la app ya permitía (su regla de cliente no miraba la hora). Con
      // `isPast` el botón "Confirmar" desaparecería justo en la aceptación
      // tardía, que es el único caso en que la ventana sirve de algo.
      canConfirm: canRespond,
      // DECLINAR sí lo lleva: decir "no asisto" de una actividad que ya pasó no
      // significa nada, y es la regla que el flag ya tenía.
      canDecline: canRespond && !isPast,
      canComplete:
        activity.status === ActivityStatus.IN_PROGRESS || activity.status === ActivityStatus.VERIFY,
      isPast,
    };
  }

  /**
   * ¿Sigue abierta la ventana de deshacer? El reloj del servidor decide, no el
   * temporizador del cliente: si la app muere a mitad de ventana el borrado se
   * sostiene, que es el comportamiento aceptado (D1).
   */
  isWithinUndoWindow(actedAt: Date | null, now: Date): boolean {
    if (actedAt === null || actedAt === undefined) {
      return false;
    }
    const elapsed = now.getTime() - actedAt.getTime();
    // `<=`, no `<`: el límite de 5000 ms es INCLUYENTE, así que una acción fechada
    // exactamente hace 5000 ms todavía se puede deshacer.
    return elapsed >= 0 && elapsed <= UNDO_WINDOW_MS;
  }
}

/**
 * Estados en los que la actividad ya no admite acciones de creatives.
 * Se exporta para que el cliente y los tests compartan una sola definición.
 *
 * ⚠ Deliberadamente NO se usa como guarda de `can_*`: las rulings fijan la
 * matriz en rol + tiempo, y añadir una regla de estado sería inventar política.
 * Se expone para las etiquetas y para el mapa de `undo-decline`.
 */
export const TERMINAL_ACTIVITY_STATUSES: readonly ActivityStatus[] = [
  ActivityStatus.CANCELLED,
  ActivityStatus.DONE,
];
