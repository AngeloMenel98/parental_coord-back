import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** B4 · `GET /admin/bonds/:bondId/trend?months=6` */
export class BondTrendQueryDto {
  @ApiPropertyOptional({ example: 6, minimum: 1, maximum: 12, default: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  months?: number;
}
