import { Exclude, Expose } from 'class-transformer';

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
  @Expose() assignedConfirmed!: boolean;
  @Expose() confirmedAt!: string | null;

  /**
   * R1 · Los tres flags los CALCULA el servidor (`ActivityPolicyService`) para
   * ESTE visor. El cliente no los recalcula: sólo los refleja para decidir si
   * monta el riel de swipe. Vienen por defecto en `false` para que un servidor
   * viejo (o una actividad sin campos) degrade a "sin acciones" en vez de a
   * "acciones que fallarán".
   */
  @Expose() canDelete!: boolean;
  @Expose() canCancel!: boolean;
  @Expose() canDecline!: boolean;
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
  @Expose() assignedConfirmed!: boolean;
  @Expose() confirmedAt!: string | null;

  @Expose() canDelete!: boolean;
  @Expose() canCancel!: boolean;
  @Expose() canDecline!: boolean;

  /** `now >= coalesce(scheduledEnd, scheduledStart)` — sólo en el detalle. */
  @Expose() isPast!: boolean;

  /**
   * A3 · El motivo de "No asistir" lo ve TODA la actividad del vínculo, ya no
   * sólo el creador: el campo viaja tal cual y sin filtrar.
   *
   * 🔴 Que no cruce de vínculos NO lo decide este campo, lo decide el chequeo de
   * membresía que precede a la lectura: `getDetail` responde 404 a quien no es
   * miembro activo del vínculo de la actividad. Este DTO nunca se construye para
   * un no-miembro, así que no hay rama que se pueda equivocar aquí.
   *
   * Sigue siendo `null` (no se omite) cuando nadie ha declinado, para que el
   * contrato KMP sea exacto.
   */
  @Expose() declinedReason!: string | null;
}
