import { IsOptional } from 'class-validator';

export class CancelActivityDto {
  @IsOptional()
  reason?: unknown;
}
