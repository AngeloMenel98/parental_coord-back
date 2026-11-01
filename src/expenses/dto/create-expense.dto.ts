import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * El alta de un gasto (§5.3 del PRD).
 *
 * Los campos son EXACTAMENTE los del formulario del PRD — título, monto,
 * categoría, fecha, notas y reparto. `childId` y `activityId` existen en la tabla
 * pero NO se aceptan acá: el PRD no los pide en el formulario, y `activity_id` es
 * el origen de una conversión de adjunto (R6), que llega con T27 y verifica que
 * la actividad sea del mismo vínculo. Aceptarlo ahora dejaría apuntar un gasto a
 * la actividad de otro vínculo sin validar nada.
 *
 * El `whitelist` + `forbidNonWhitelisted` globales convierten cualquier campo de
 * más en 400, así que este DTO es también la lista de lo que el cliente PUEDE
 * mandar.
 */
export class CreateExpenseDto {
  @ApiProperty({ minLength: 1, maxLength: 255, example: 'Consulta pediatra' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 255)
  concept!: string;

  @ApiPropertyOptional({ maxLength: 2000, example: 'Incluye medicación' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 15000.5, description: 'Positivo, hasta 2 decimales (numeric(12,2)).' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999.99)
  amount!: number;

  @ApiProperty({ format: 'uuid', description: 'Obligatoria al crear (§5.3: "Category — Yes").' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ example: '2026-10-30', description: 'Fecha del gasto, `YYYY-MM-DD`.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expenseDate must be YYYY-MM-DD' })
  expenseDate!: string;

  @ApiPropertyOptional({
    example: 50,
    minimum: 0,
    maximum: 100,
    description:
      'Porcentaje que paga quien solicita. La otra parte recibe 100 menos esto, así que ' +
      'un reparto que no sume 100 es IMPOSIBLE de mandar.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  splitRatioPayer?: number;
}
