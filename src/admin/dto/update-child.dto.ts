import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * B1 · Edición parcial de un hijo desde el admin (S3/S4).
 *
 * Cada campo es opcional; `dateOfBirth` acepta `null` para borrar la fecha, pero
 * nunca `""`: `@IsOptional()` salta la validación sólo con `null`/`undefined`, así
 * que un string vacío cae en `@IsDateString()` y responde 400.
 */
export class UpdateChildDto {
  @ApiPropertyOptional({ example: 'Mateo' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  firstName?: string;

  @ApiPropertyOptional({ example: 'García' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  lastName?: string;

  @ApiPropertyOptional({ example: '2020-05-15', nullable: true })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string | null;
}
