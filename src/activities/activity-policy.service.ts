import { Injectable } from '@nestjs/common';
import { ActivityStatus } from './entities/activity.entity';

/** Ventana de deshacer, en milisegundos. La posee el SERVIDOR ([isWithinUndoWindow]). */
export const UNDO_WINDOW_MS = 5000;

/**
 * Los campos que la política necesita. Deliberadamente un tipo estructural y no
 * `ActivityEntity`: la política es PURA y no toca la base de datos, así que se
 * puede ejercitar sin TypeORM y sin contenedor.
 */
export interface PolicySubject {
  createdBy: string;
  assignedTo: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
}

export interface ActivityPolicyDecision {
  canDelete: boolean;
  canCancel: boolean;
  canDecline: boolean;
  isPast: boolean;
}

/**
 * Fuente ÚNICA de verdad de `can_*` e `isPast`.
 *
 * El servidor es la autoridad (R1) y el cliente sólo refleja estos flags para
 * pintar el affordance: si el cliente recalculara la regla, dos copias divergirían
 * en cuanto cambiara una. Por eso esta clase NO recibe `Clock`: el `now` llega
 * como parámetro desde el llamador, que sí lo tiene inyectado y mockeado.
 */
@Injectable()
export class ActivityPolicyService {
  /**
   * `now >= coalesce(scheduledEnd, scheduledStart)`.
   *
   * `coalesce` es la regla: una actividad sin hora de fin sigue siendo actionable
   * hasta su inicio, y una sin ninguna de las dos no tiene ancla temporal — se
   * considera NO pasada en lugar de tratar `null` como "terminó hace tiempo"
   * (comparar contra `null` en JS es siempre `false`, así que sin este caso
   * explícito el `coalesce` sería silencioso).
   *
   * `deadline` no participa: es un plazo de cumplimiento, no el fin de la
   * actividad.
   */
  isPast(activity: PolicySubject, now: Date): boolean {
    const anchor = activity.scheduledEnd ?? activity.scheduledStart;
    if (anchor === null || anchor === undefined) {
      return false;
    }
    return now.getTime() >= anchor.getTime();
  }

  /**
   * Matriz de decisión.
   *
   * - `canDelete` / `canCancel`: sólo el creador (A3 del PRD, ruling en firme).
   * - `canDecline`: sólo el asignado.
   * - Las tres se anulan cuando la actividad ya pasó, y por eso una actividad en
   *   curso (`inicio < now < fin`) conserva las acciones POR CONSTRUCCIÓN: no hay
   *   ningún caso especial para "en curso".
   */
  evaluate(activity: PolicySubject, viewerId: string, now: Date): ActivityPolicyDecision {
    const isPast = this.isPast(activity, now);
    const isCreator = activity.createdBy === viewerId;
    const isAssignee = activity.assignedTo !== null && activity.assignedTo === viewerId;

    return {
      canDelete: isCreator && !isPast,
      canCancel: isCreator && !isPast,
      canDecline: isAssignee && !isPast,
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
