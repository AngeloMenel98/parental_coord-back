import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChildDto {
  @ApiProperty({ example: 'Mateo', description: 'Nombre del niño' })
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty({ example: 'García', description: 'Apellido del niño' })
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiPropertyOptional({ example: '2020-05-15', description: 'Fecha de nacimiento (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;
}
