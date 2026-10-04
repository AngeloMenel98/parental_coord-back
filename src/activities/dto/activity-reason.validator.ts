/**
 * Validador COMPARTIDO del motivo, 3–200 caracteres.
 *
 * 🔴 Por qué NO son decoradores de class-validator (`@Length(3,200)`): el
 * `ValidationPipe` global responde **400**, y el contrato de este cambio exige
 * **422** con código estable `VALIDATION_FAILED`. Si el motivo lo validase el
 * pipe, el 422 sería inalcanzable; y cambiar el pipe global a 422 alteraría el
 * contrato de todos los demás módulos. Por eso los DTOs sólo llevan
 * `@IsOptional()` (para que `forbidNonWhitelisted` no rechace la propiedad) y la
 * comprobación real ocurre aquí, en el servicio, lanzando `CodedException`.
 *
 * Cancelar y No asistir usan EXACTAMENTE la misma función: una sola regla, un solo
 * sitio donde cambiarla, imposible que se desincronicen.
 */

/** Límite inferior y superior del motivo. Compartido por cancel y decline. */
export const ACTIVITY_REASON_MIN = 3;
export const ACTIVITY_REASON_MAX = 200;

/** Motivo ya normalizado: sin relleno de espacios en los extremos. */
export type ValidActivityReason = string;

export type ActivityReasonRejection = 'missing' | 'not_a_string' | 'too_short' | 'too_long';

export type ActivityReasonValidation =
  | { ok: true; value: ValidActivityReason }
  | { ok: false; reason: ActivityReasonRejection; message: string };

/**
 * Normaliza y valida. Sólo recorta los extremos: los espacios interiores se
 * conservan, porque "no  puedo" es un motivo válido y distinctly distinto de
 * "no puedo".
 */
export function validateActivityReason(raw: unknown): ActivityReasonValidation {
  if (raw === undefined || raw === null) {
    return {
      ok: false,
      reason: 'missing',
      message: `reason is required and must be ${ACTIVITY_REASON_MIN}-${ACTIVITY_REASON_MAX} characters`,
    };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      reason: 'not_a_string',
      message: 'reason must be a string',
    };
  }

  const value = raw.trim();
  if (value.length < ACTIVITY_REASON_MIN) {
    return {
      ok: false,
      reason: 'too_short',
      message: `reason must be at least ${ACTIVITY_REASON_MIN} characters`,
    };
  }
  if (value.length > ACTIVITY_REASON_MAX) {
    return {
      ok: false,
      reason: 'too_long',
      message: `reason must be at most ${ACTIVITY_REASON_MAX} characters`,
    };
  }
  return { ok: true, value };
}
