import { ApiProperty } from '@nestjs/swagger';

import { ExpenseStatus } from '../entities/expense.entity';

/**
 * Vista de UN gasto.
 *
 * Trae el gasto **y la decisión de la política para el viewer** en la misma
 * respuesta. Es a propósito: la UI de detalle (T19) tiene que saber qué botones
 * mostrar sin replicar las reglas de FR-11 en el cliente ni descubrirlas
 * chocando contra un 403. Las reglas viven en el servidor; el cliente las
 * consume como datos.
 *
 * `amount` y los ratios son `number` aunque las columnas sean `numeric`: el
 * driver de `pg` devuelve `numeric` como STRING, y un cliente que recibe
 * `"15000.50"` no puede sumar sin parsear. La conversión se hace en el mapeo.
 */
export class ExpenseResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  bondId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  categoryId!: string | null;

  @ApiProperty({ nullable: true, example: 'Salud' })
  categoryName!: string | null;

  @ApiProperty()
  concept!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ example: 15000.5 })
  amount!: number;

  @ApiProperty({ example: '2026-10-30' })
  expenseDate!: string;

  @ApiProperty({ example: 50 })
  splitRatioPayer!: number;

  @ApiProperty({ example: 50 })
  splitRatioOther!: number;

  @ApiProperty({ enum: ExpenseStatus })
  status!: ExpenseStatus;

  @ApiProperty({ format: 'uuid', description: 'Quién solicitó el gasto.' })
  requestedBy!: string;

  /**
   * La otra parte del vínculo, o `null` si el vínculo todavía tiene un solo
   * miembro. Es la misma identidad con la que decide la política.
   */
  @ApiProperty({ format: 'uuid', nullable: true })
  counterpartId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  approvedBy!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  approvedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  paidAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  // ── Decisión de la política para quien consulta ──────────────────────────

  @ApiProperty({ description: 'FR-11 · el viewer puede editar.' })
  canEdit!: boolean;

  @ApiProperty({ description: 'FR-11 · el viewer puede cancelar.' })
  canCancel!: boolean;

  @ApiProperty()
  canApprove!: boolean;

  @ApiProperty()
  canReject!: boolean;

  @ApiProperty()
  canMarkPaid!: boolean;

  @ApiProperty({ description: '`paid` y `rejected` no admiten ninguna transición.' })
  isTerminal!: boolean;

  @ApiProperty({ description: 'R6 · derivado: existe al menos un expense_attachment.' })
  hasDocument!: boolean;
}
