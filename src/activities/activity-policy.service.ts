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
  canAssign: boolean;
  canReassign: boolean;
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

  /**
   * `viewer` es el ROL de quien mira, no su identidad: un tercero temporal no puede
   * asignar, reasignar, confirmar, rechazar, cancelar ni borrar (S8), mire lo que mire.
   *
   * Es un parámetro opcional para que los llamantes que todavía no resuelven el rol
   * sigan compilando con el comportamiento de siempre — pero los seis call-sites de
   * `ActivitiesService` ya lo pasan, así que en producción no hay default.
   */
  evaluate(
    activity: PolicySubject,
    viewerId: string,
    now: Date,
    viewer: { isThirdParty: boolean } = { isThirdParty: false },
  ): ActivityPolicyDecision {
    const isPast = this.isPast(activity, now);
    const isCreator = activity.createdBy === viewerId;
    const isAssignee = activity.assignedTo !== null && activity.assignedTo === viewerId;

    // Origin rule (T8): el "NO ASISTE" tardío existe SÓLO cuando el `overdue`
    // viene de `assigned`. La origen la define `overdueOrigin()` — la misma
    // función que usa el guard del servicio.
    const origin = overdueOrigin(activity);

    // ⚠ LA ACEPTACIÓN TARDÍA SE FUERA (decisión del usuario, 2026-11-03).
    //
    // Antes `canConfirm` era TRUE también en `overdue` (la aceptación tardía, T8):
    // el botón "Confirmar" sobrevivía a la ventana de 36 h, y el asignado podía
    // "rescatar" la actividad. Pasó con "A largo plazo": su ventana venció el 31
    // de octubre, el botón siguió ahí, y el 3 de noviembre se confirmó tarde y la
    // actividad volvió a `assisting`. Parecía una actividad vigente con un botón
    // de acción, y no lo era: la ventana ya se había cerrado.
    //
    // Ahora `canConfirm` es SÓLO en `assigned`: una actividad vencida se devuelve.
    // Y el "NO ASISTE" tardío SÍ se queda, y es lo que evita el callejón: el que no
    // aceptó en la ventana devuelve la actividad (`not_assisting`), y de ahí la
    // reasigna cualquiera (T9). Sin esa salida, una actividad vencida sólo se
    // podría cancelar.
    const canConfirm = isAssignee && activity.status === ActivityStatus.ASSIGNED;

    const canDecline =
      isAssignee &&
      (activity.status === ActivityStatus.ASSIGNED ||
        (activity.status === ActivityStatus.OVERDUE && origin === 'assigned')) &&
      !isPast;

    if (viewer.isThirdParty) {
      // El tercero sólo finaliza lo suyo (S8/S11): la matriz completa, en un solo lugar,
      // para que no dependa de que cada bandera se acuerde del rol.
      return {
        canDelete: false,
        canCancel: false,
        canAssign: false,
        canReassign: false,
        canConfirm: false,
        canDecline: false,
        canComplete:
          isAssignee &&
          (activity.status === ActivityStatus.IN_PROGRESS ||
            activity.status === ActivityStatus.VERIFY),
        isPast,
      };
    }

    return {
      canDelete: isCreator && !isPast,
      canCancel: isCreator && !isPast,
      canAssign: activity.status === ActivityStatus.CREATED,
      canReassign: activity.status === ActivityStatus.NOT_ASSISTING,
      // CONFIRMAR no lleva `isPast`: confirmar una actividad YA terminada es el
      // caso normal — la ventana de verificación existe justo para eso — y es lo
      // que la app ya permitía (su regla de cliente no miraba la hora).
      canConfirm,
      // DECLINAR sí lo lleva: decir "no asisto" de una actividad que ya pasó no
      // significa nada, y es la regla que el flag ya tenía.
      canDecline,
      // S13 / D5 — FINALIZAR ES DEL ASIGNADO, PARA TODOS LOS ROLES.
      //
      // Antes esta línea sólo miraba el estado (F1): cualquier miembro del vínculo —
      // incluido el otro progenitor, o un tercero al que no le asignaron nada— podía
      // cerrar una actividad ajena. El estado sigue siendo condición necesaria, pero
      // nunca suficiente: sin `isAssignee` no hay "Finalizar".
      canComplete:
        isAssignee &&
        (activity.status === ActivityStatus.IN_PROGRESS ||
          activity.status === ActivityStatus.VERIFY),
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
