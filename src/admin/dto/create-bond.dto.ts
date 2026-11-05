import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AgreementType } from '../../bonds/entities/bond.entity';

/**
 * B5 · un hijo que nace junto con el vínculo.
 *
 * La fecha es opcional porque el admin puede no tenerla a mano; el nombre y el
 * apellido no: un hijo sin nombre no es un dato, es un renglón vacío.
 */
export class CreateBondChildDto {
  @ApiProperty({ example: 'Mateo' })
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty({ example: 'Paz' })
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiPropertyOptional({ example: '2020-05-15', description: 'Fecha ISO 8601 (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string | null;
}

/**
 * B5 · el vínculo se crea completo o no se crea.
 *
 * `children` es obligatorio y con al menos un elemento: el producto considera
 * inválido un vínculo sin hijos, así que dejarlo opcional sólo trasladaría el
 * problema a una fila huérfana que ninguna pantalla muestra.
 */
export class CreateBondDto {
  @ApiProperty({ example: 'Paz–Gómez' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({ enum: AgreementType, example: AgreementType.FORMAL })
  @IsEnum(AgreementType)
  agreementType!: AgreementType;

  @ApiProperty({ type: [String], description: 'Exactamente dos progenitores' })
  @IsArray()
  @ArrayMinSize(2)
  @IsUUID('4', { each: true })
  userIds!: string[];

  @ApiProperty({ type: [CreateBondChildDto], description: 'Al menos un hijo' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateBondChildDto)
  children!: CreateBondChildDto[];
}
