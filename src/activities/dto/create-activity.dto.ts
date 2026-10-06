import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ArrayNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ActivityType, Criticality } from '../entities/activity.entity';

export class CreateActivityDto {
  @ApiProperty({ example: 'Reunión de padres', description: 'Título de la actividad' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({ enum: ActivityType, example: ActivityType.EVENT, description: 'Tipo de actividad' })
  @IsEnum(ActivityType)
  type!: ActivityType;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'ID de la categoría' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'ID del usuario asignado' })
  @IsUUID()
  assignedTo!: string;

  @ApiProperty({
    enum: Criticality,
    example: Criticality.MEDIUM,
    description: 'Nivel de criticidad',
  })
  @IsEnum(Criticality)
  criticality!: Criticality;

  @ApiPropertyOptional({ description: 'Descripción de la actividad' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '2026-10-01T10:00:00Z', description: 'Fecha/hora de inicio programada (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  scheduledStart?: string;

  @ApiPropertyOptional({ example: '2026-10-01T12:00:00Z', description: 'Fecha/hora de fin programada (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  scheduledEnd?: string;

  @ApiPropertyOptional({ example: '2026-10-01T12:00:00Z', description: 'Fecha límite (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiPropertyOptional({
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
    description: 'IDs de los hijos involucrados en la actividad',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  childrenIds?: string[];
}
