import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

import { ThirdPartyRelationship } from '../../expenses/entities/auth-third-party.entity';

/**
 * Alta de un acceso temporal (S2/S7).
 *
 * **Crea la cuenta si el email no existe.** Desde S1/D2 el alta genera una contraseña
 * provisional, crea la cuenta y la envía por mail; si el mail no sale, la transacción
 * revierte cuenta y acceso. Con una cuenta existente no se toca su contraseña: se manda
 * sólo un aviso de acceso.
 */
export class CreateThirdPartyDto {
  @ApiProperty({
    example: 'Pablo',
    description: 'Nombre de pila del tercero, para la asignación y la atribución en cards',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 80)
  firstName!: string;

  @ApiProperty({
    example: 'Charles',
    description: 'Apellido del tercero, para la asignación y la atribución en cards',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 80)
  lastName!: string;

  @ApiPropertyOptional({ description: 'Teléfono de contacto del tercero' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(0, 30)
  phone?: string;

  @ApiPropertyOptional({ description: 'Documento de identidad del tercero (DNI/CI)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(0, 30)
  document?: string;

  @ApiProperty({
    example: 'abuela@example.com',
    description: 'Email del tercero; si no tiene cuenta, el alta la crea y le manda las credenciales',
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
