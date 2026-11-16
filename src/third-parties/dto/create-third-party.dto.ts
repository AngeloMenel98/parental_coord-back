import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

import { ThirdPartyRelationship } from '../../expenses/entities/auth-third-party.entity';

/**
 * Alta de un acceso temporal (S2/S7).
 *
 * **No crea credenciales.** D4 dejó el SMTP/Gmail diferido, así que el alta busca una
 * cuenta existente por email; si no existe, el servicio responde 422 explicando que el
 * alta con credenciales está pendiente. Inventar una contraseña aquí sería convertir un
 * pendiente de producto en una decisión de seguridad.
 */
export class CreateThirdPartyDto {
  @ApiProperty({
    example: 'abuela@example.com',
    description: 'Email de una cuenta que ya existe en la app',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @ApiProperty({
    enum: ThirdPartyRelationship,
    enumName: 'ThirdPartyRelationship',
    description: 'Relación declarada por el progenitor',
  })
  @IsEnum(ThirdPartyRelationship)
  relationship!: ThirdPartyRelationship;

  @ApiProperty({
    example: '2026-12-12',
    description: 'Vencimiento del acceso (ISO date YYYY-MM-DD, obligatorio por D3)',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'accessEnd must be YYYY-MM-DD' })
  accessEnd!: string;

  @ApiPropertyOptional({ description: 'Nota libre del progenitor sobre el alcance' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}
