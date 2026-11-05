import { ApiProperty } from '@nestjs/swagger';

/**
 * Respuesta de confirmación/conversión de un adjunto de gasto.
 *
 * Espeja la forma del cliente Kotlin para adjuntos de actividad: el objeto
 * `uploadedBy` lleva el `id`, no el uuid suelto.
 */
export class ExpenseAttachmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  expenseId!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  fileType!: string;

  @ApiProperty({ type: () => Object })
  uploadedBy!: { id: string };

  @ApiProperty({ format: 'date-time' })
  uploadedAt!: string;

  @ApiProperty({ nullable: true })
  viewUrl!: string | null;
}
