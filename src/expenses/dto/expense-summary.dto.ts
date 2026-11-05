import { ApiProperty } from '@nestjs/swagger';

/**
 * Saldo y conteo de gastos de un vínculo, desde la perspectiva de quien consulta.
 *
 * R1: un solo número firmado (`saldo`) y dos vistas sin signo (`porPagar`,
 * `porCobrar`). El cliente nunca recomputa el saldo.
 */
export class ExpenseSummaryDto {
  @ApiProperty({ description: 'Saldo firmado desde la perspectiva del viewer.' })
  saldo!: number;

  @ApiProperty({ description: 'Magnitud de la deuda del viewer hacia la otra parte.' })
  porPagar!: number;

  @ApiProperty({ description: 'Magnitud de lo que le deben al viewer.' })
  porCobrar!: number;

  @ApiProperty({
    type: 'object',
    properties: {
      pendientes: { type: 'number' },
      aprobados: { type: 'number' },
      pagados: { type: 'number' },
      rechazados: { type: 'number' },
    },
  })
  counts!: {
    pendientes: number;
    aprobados: number;
    pagados: number;
    rechazados: number;
  };
}
