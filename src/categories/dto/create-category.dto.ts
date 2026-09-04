import { IsBoolean, IsHexColor, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Salud', description: 'Nombre único de la categoría' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'Actividades médicas y de salud' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '#FF5733', description: 'Color hex para la UI' })
  @IsOptional()
  @IsString()
  @IsHexColor()
  @MaxLength(7)
  color?: string;

  @ApiPropertyOptional({ example: 'heart-pulse', description: 'Nombre del icono' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
