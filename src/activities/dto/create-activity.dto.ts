import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { ActivityType } from '../entities/activity.entity';
import { IsIso8601WithOffset } from '../../common/validators/is-iso-8601-with-offset.validator';

export class CreateActivityDto {
  @ApiProperty({ minLength: 3, maxLength: 80, example: 'Ir al pediatra' })
  @IsString()
  @Length(3, 80)
  title!: string;

  @ApiPropertyOptional({ maxLength: 500, example: 'Turno a las 10:00 con Dr. Pérez' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: ActivityType, default: ActivityType.EVENT })
  @IsOptional()
  @IsEnum(ActivityType)
  type?: ActivityType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @ApiProperty({
    example: '2026-10-05T10:00:00-03:00',
    format: 'date-time',
    description:
      'Instante ISO-8601 con offset explícito obligatorio (Z o ±HH:MM). Sin offset ⇒ 400.',
  })
  @IsString()
  @IsIso8601WithOffset()
  scheduledStart!: string;

  @ApiPropertyOptional({
    example: '2026-10-05T11:00:00-03:00',
    format: 'date-time',
    description: 'Instante ISO-8601 con offset explícito obligatorio si se proporciona.',
  })
  @IsOptional()
  @IsString()
  @IsIso8601WithOffset()
  scheduledEnd?: string;

  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, uniqueItems: true })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  childrenIds!: string[];
}
