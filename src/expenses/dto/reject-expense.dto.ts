import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Motivo del rechazo. OPCIONAL: el PRD no lo exige y forzarlo haría que la
 * contraparte escriba cualquier cosa para poder rechazar. Si viene, se guarda en
 * el `detail` del audit y el gasto queda trazable.
 */
export class RejectExpenseDto {
  @ApiPropertyOptional({ maxLength: 500, example: 'El comprobante no coincide con el monto' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
