import { ApiProperty } from '@nestjs/swagger';

import { ExpenseResponseDto } from './expense-response.dto';

/**
 * Página de gastos de un vínculo.
 *
 * Reutiliza `ExpenseResponseDto` para cada ítem: el detalle y la lista no pueden
 * divergir en la forma del gasto.
 */
export class PaginatedExpensesDto {
  @ApiProperty({ type: [ExpenseResponseDto] })
  items!: ExpenseResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;
}
