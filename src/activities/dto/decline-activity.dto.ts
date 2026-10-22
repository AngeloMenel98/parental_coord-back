import { IsOptional } from 'class-validator';

export class DeclineActivityDto {
  @IsOptional()
  reason?: unknown;
}
