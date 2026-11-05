import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** B2 · S6 — ventana del reporte; ambas fechas son inclusivas. */
export class BondReportQueryDto {
  @ApiProperty({ example: '2026-06-01', description: 'Primer día incluido (YYYY-MM-DD)' })
  @IsDateString()
  dateFrom!: string;

  @ApiProperty({ example: '2026-06-30', description: 'Último día incluido (YYYY-MM-DD)' })
  @IsDateString()
  dateTo!: string;
}
