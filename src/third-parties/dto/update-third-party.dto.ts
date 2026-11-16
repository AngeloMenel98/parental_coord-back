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
}
