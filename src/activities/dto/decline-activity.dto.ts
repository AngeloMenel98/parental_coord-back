import { IsOptional } from 'class-validator';

/**
 * Cuerpo de `POST /activities/:id/decline`.
 *
 * 🔴 R5/A1 · Motivo OBLIGATORIO, 3–200 caracteres, el MISMO validador que usa
 * cancelar. Mismo motivo que en `CancelActivityDto` para no llevar `@Length`: el
 * `ValidationPipe` global responde 400 y el contrato exige 422 con código
 * `VALIDATION_FAILED`. `@IsOptional()` existe únicamente para que
 * `forbidNonWhitelisted: true` no rechace la propiedad; la obligatoriedad real la
 * impone el servicio.
 */
export class DeclineActivityDto {
  @IsOptional()
  reason?: unknown;
}
