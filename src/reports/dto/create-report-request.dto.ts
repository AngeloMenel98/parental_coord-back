import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** B3 · S9 — período del PDF; mismas reglas que el reporte JSON. */
export class CreateReportRequestDto {
  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  dateFrom!: string;

  @ApiProperty({ example: '2026-06-30' })
  @IsDateString()
  dateTo!: string;
}
