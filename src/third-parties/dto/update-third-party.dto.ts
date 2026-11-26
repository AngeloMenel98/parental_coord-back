import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

import { ThirdPartyRelationship } from '../../expenses/entities/auth-third-party.entity';

/**
 * Cambios que el progenitor dueño puede hacer sobre un acceso vigente.
 *
 * No incluye el estado: extender la fecha sí, reactivar o revocar no (D3 — revocar es
 * `DELETE`, y el terciario nunca se reactiva solo). Tampoco incluye `authoredBy`: el
 * dueño de un grant no se transfiere.
 */
export class UpdateThirdPartyDto {
  @ApiPropertyOptional({
    enum: ThirdPartyRelationship,
    enumName: 'ThirdPartyRelationship',
  })
  @IsOptional()
  @IsEnum(ThirdPartyRelationship)
  relationship?: ThirdPartyRelationship;

  @ApiPropertyOptional({ example: '2027-03-01', description: 'Nuevo vencimiento (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'accessEnd must be YYYY-MM-DD' })
  accessEnd?: string;

  @ApiPropertyOptional({ description: 'Nota libre; se puede vaciar enviando ""' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;

  /**
   * Identidad declarada (S9 de thirdparty-identity). Opcional y PATCH parcial: un campo
   * ausente NO borra el persistido — distinto de `note`, cuya vaciedad explícita (`""`)
   * sí limpia. Los grants creados antes de la feature quedan editables desde acá.
   */
  @ApiPropertyOptional({ example: 'Pablo', description: 'Nombre de pila (opcional, PATCH parcial)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 80)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Charles', description: 'Apellido (opcional, PATCH parcial)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 80)
  lastName?: string;

  @ApiPropertyOptional({ description: 'Teléfono (opcional, PATCH parcial)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(0, 30)
  phone?: string;

  @ApiPropertyOptional({ description: 'Documento (opcional, PATCH parcial)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(0, 30)
  document?: string;
}
