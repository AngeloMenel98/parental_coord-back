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
  @Expose() assignedConfirmed!: boolean;
  @Expose() confirmedAt!: string | null;
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
  @Expose() assignedConfirmed!: boolean;
  @Expose() confirmedAt!: string | null;
}
