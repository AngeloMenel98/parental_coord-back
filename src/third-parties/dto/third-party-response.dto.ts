import { ApiProperty } from '@nestjs/swagger';

import { AuthThirdStatus, ThirdPartyRelationship } from '../../expenses/entities/auth-third-party.entity';

/**
 * El grant tal como lo consumen el progenitor dueño y el propio visitante.
 *
 * Los nombres de campo son el contrato del front (`ThirdPartyGrant` en
 * `parental_coord-front`): `endDate` y `startDate` viajan como `YYYY-MM-DD` porque la
 * columna es `date` y el cliente los parsea como fecha local, sin hora ni zona que
 * puedan correr el día.
 *
 * `authorizedByName` es el único dato de otra persona que ve el terciario (S12): quién
 * le dio el acceso. No viaja el resto de los miembros del vínculo.
 */
export class ThirdPartyResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  bondId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ nullable: true, description: 'Nombre del visitante dentro del vínculo' })
  displayName!: string | null;

  @ApiProperty({ enum: ThirdPartyRelationship, enumName: 'ThirdPartyRelationship' })
  relationship!: ThirdPartyRelationship;

  @ApiProperty({ example: '2026-11-05', nullable: true })
  startDate!: string | null;

  @ApiProperty({ example: '2026-12-12' })
  endDate!: string;

  @ApiProperty({ enum: AuthThirdStatus, enumName: 'AuthThirdStatus' })
  status!: AuthThirdStatus;

  @ApiProperty({ format: 'uuid' })
  authorizedBy!: string;

  @ApiProperty({ nullable: true })
  authorizedByName!: string | null;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ nullable: true, description: 'ISO-8601 del momento de la revocación' })
  revokedAt!: string | null;
}
