import { Exclude, Expose, Type, Transform } from 'class-transformer';
import { ActivityStatus } from '../entities/activity.entity';

/**
 * S7 — la atribución de autoría la decide el SERVIDOR, mirando QUIÉN pregunta.
 *
 * `name` (el nombre real del terciario, declarado en el alta del grant) sólo viaja
 * cuando el que pregunta es el progenitor que lo autorizó; cualquier otro miembro
 * recibe `name: null` + `authorizedByName` ("Autorizado por YO"). El front nunca
 * recibe el nombre real si no lo puede pintar: es una regla de DATOS, no de pintado.
 */
@Exclude()
export class ActivityAttributionDto {
  @Expose() kind!: 'member' | 'third_party';
  @Expose() name!: string | null;
  /** Sólo `third_party`; para `member` el campo queda sin exponer (undefined). */
  @Expose() authorizedByName?: string | null;
}

@Exclude()
export class ActivitySummaryDto {
  @Expose() id!: string;
  @Expose() title!: string;
  @Expose() type!: string;
  @Expose() status!: string;
  @Expose() categoryId!: string;
  @Expose() scheduledStart!: string | null;
  @Expose() deadline!: string | null;
  @Expose() assignedTo!: string | null;
  @Expose() criticality!: string;
  @Expose() scheduledEnd!: string | null;
  @Expose() completedAt!: string | null;
  @Expose() confirmedAt!: string | null;

  /**
   * Derivado (REQ-TRANS-3, AC-12): ya no hay booleano almacenado. `@Transform`
   * lo materializa como propiedad propia para que sobreviva a `JSON.stringify`
   * (un getter de prototipo se perdería sin `ClassSerializerInterceptor`).
   */
  @Expose()
  @Transform(({ obj }) => obj.status === ActivityStatus.ASSISTING && obj.confirmedAt != null)
  assignedConfirmed!: boolean;

  @Expose() canDelete!: boolean;
  @Expose() canCancel!: boolean;
  @Expose() canAssign!: boolean;
  @Expose() canReassign!: boolean;
  @Expose() canConfirm!: boolean;
  @Expose() canDecline!: boolean;
  @Expose() canComplete!: boolean;
  @Expose() childrenIds: string[] = [];

  /** S7 — atribución de autoría según el viewer (ver `ActivityAttributionDto`). */
  @Expose()
  @Type(() => ActivityAttributionDto)
  attribution: ActivityAttributionDto | null = null;
}

@Exclude()
export class ActivityDetailDto {
  @Expose() id!: string;
  @Expose() title!: string;
  @Expose() type!: string;
  @Expose() status!: string;
  @Expose() categoryId!: string;
  @Expose() criticality!: string;
  @Expose() description!: string;
  @Expose() scheduledStart!: string | null;
  @Expose() deadline!: string | null;
  @Expose() assignedTo!: string | null;
  @Expose() createdBy!: string;
  @Expose() createdAt!: string;
  @Expose() scheduledEnd!: string | null;
  @Expose() completedAt!: string | null;
  @Expose() confirmedAt!: string | null;

  /** Derivado (REQ-TRANS-3, AC-12): `status === assisting && confirmedAt != null`. */
  @Expose()
  @Transform(({ obj }) => obj.status === ActivityStatus.ASSISTING && obj.confirmedAt != null)
  assignedConfirmed!: boolean;

  @Expose() canDelete!: boolean;
  @Expose() canCancel!: boolean;
  @Expose() canAssign!: boolean;
  @Expose() canReassign!: boolean;
  @Expose() canConfirm!: boolean;
  @Expose() canDecline!: boolean;
  @Expose() canComplete!: boolean;

  @Expose() isPast!: boolean;

  @Expose() declinedReason!: string | null;

  @Expose() childrenIds: string[] = [];

  /** S7 — atribución de autoría según el viewer (ver `ActivityAttributionDto`). */
  @Expose()
  @Type(() => ActivityAttributionDto)
  attribution: ActivityAttributionDto | null = null;
}
