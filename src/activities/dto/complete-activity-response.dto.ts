import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class CompleteActivityResponseDto {
  @Expose()
  id!: string;

  @Expose()
  status!: string;

  @Expose()
  completedAt!: string | null;
}
