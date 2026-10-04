import { IsOptional } from 'class-validator';

/**
 * Cuerpo de `POST /activities/:id/cancel`.
 *
 * 🔴 A1 · El motivo es OBLIGATORIO y comparte el validador 3–200 con "No asistir"
 * (`activity-reason.validator.ts`). Aquí NO hay decoradores de longitud a
 * propósito: el `ValidationPipe` global responde 400, y el contrato pide 422 con
 * código `VALIDATION_FAILED`. Por eso el campo sólo lleva `@IsOptional()` —para
 * que `forbidNonWhitelisted` no lo rechace como propiedad desconocida— y la
 * comprobación real ocurre en el servicio.
 *
 * La propiedad se declara `unknown` porque el servicio tiene que poder distinguir
 * "no vine" de "vino un 123" y responder 422 en ambos casos, en vez de dejar que
 * una coerción de tipos lo convierta en un 400.
 */
export class CancelActivityDto {
  @IsOptional()
  reason?: unknown;
}
