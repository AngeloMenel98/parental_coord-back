import { Exclude, Expose, Transform } from 'class-transformer';
import { ActivityStatus } from '../entities/activity.entity';

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
  @Expose() canDecline!: boolean;
  @Expose() childrenIds: string[] = [];
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
  @Expose() canDecline!: boolean;

  @Expose() isPast!: boolean;

  @Expose() declinedReason!: string | null;
}
