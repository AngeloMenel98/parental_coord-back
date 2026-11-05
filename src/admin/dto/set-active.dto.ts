import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** B1 · Cuerpo común de `PATCH /admin/users/:id` y `PATCH /admin/bonds/:id`. */
export class SetActiveDto {
  @ApiProperty({ example: false, description: 'Deja la fila activa o inactiva' })
  @IsBoolean()
  isActive!: boolean;
}
