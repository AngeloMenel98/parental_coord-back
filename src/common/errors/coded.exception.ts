import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Códigos de error ESTABLES del contrato de swipe de actividades.
 *
 * 🔴 El cuerpo de error que emite `HttpExceptionFilter` es `{statusCode,message,
 * error,timestamp,path}` — SIN código. Por eso el cliente no puede ramificar
 * sobre "409" ni sobre el texto: hace falta una clave estable. Se añade `code`
 * (y `details`) sólo para las excepciones que pasan por [CodedException]; el
 * resto de módulos sigue emitiendo exactamente el mismo cuerpo que antes.
 *
 * `ACTIVITY_ALREADY_PAST` y `ACTIVITY_UNDO_WINDOW_EXPIRED` comparten el 409 a
 * propósito: son distinguished por `code`, no por el status.
 */
export const ACTIVITY_ERROR_CODES = {
  /** La actividad no existe, o el llamador no es miembro del vínculo (no se revela existencia). */
  NOT_FOUND: 'ACTIVITY_NOT_FOUND',
  /** Miembro del vínculo, pero no es el creador (o el asignado) de la acción. */
  FORBIDDEN: 'ACTIVITY_FORBIDDEN',
  /** `now >= coalesce(scheduledEnd, scheduledStart)` — la actividad ya pasó. */
  ALREADY_PAST: 'ACTIVITY_ALREADY_PAST',
  /** Se intentó `restore`/`undo-decline` fuera de la ventana de 5000 ms. */
  UNDO_WINDOW_EXPIRED: 'ACTIVITY_UNDO_WINDOW_EXPIRED',
  /** Motivo fuera del rango compartido 3–200, o cuerpo mal formado. */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
} as const;

export type ActivityErrorCode = (typeof ACTIVITY_ERROR_CODES)[keyof typeof ACTIVITY_ERROR_CODES];

/** Forma del cuerpo de error cuando hay código estable. */
export interface CodedErrorBody {
  statusCode: number;
  code: ActivityErrorCode;
  message: string;
  error: string;
  details?: unknown;
}

/**
 * `HttpException` que transporta un `code` estable hasta el filtro global.
 *
 * ⚠ El 422 se lanza ASÍ, de forma explícita, y NUNCA cambiando el
 * `ValidationPipe` global: ese pipe es compartido por todos los módulos y hoy
 * responde 400; pasarlo a 422 alteraría el contrato de endpoints ajenos a este
 * cambio. Los decoradores de class-validator no sirven aquí justamente porque el
 * pipe los convierte en 400 antes de que el servicio pueda responder.
 */
export class CodedException extends HttpException {
  public readonly code: ActivityErrorCode;

  constructor(code: ActivityErrorCode, statusCode: HttpStatus, message: string, details?: unknown) {
    const body: CodedErrorBody = {
      statusCode,
      code,
      message,
      error: httpErrorLabel(statusCode),
      ...(details === undefined ? {} : { details }),
    };
    super(body, statusCode);
    this.code = code;
  }
}

/** Réplica de la etiqueta `error` que Nest usa por defecto, sin depender de internals. */
function httpErrorLabel(status: number): string {
  switch (status) {
    case HttpStatus.NOT_FOUND:
      return 'Not Found';
    case HttpStatus.FORBIDDEN:
      return 'Forbidden';
    case HttpStatus.CONFLICT:
      return 'Conflict';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'Unprocessable Entity';
    default:
      return 'Error';
  }
}

/** Atajos de alto nivel para no repetir `new CodedException(...)` en el servicio. */

export function activityNotFound(message = 'Activity not found'): CodedException {
  return new CodedException(ACTIVITY_ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, message);
}

export function activityForbidden(message: string): CodedException {
  return new CodedException(ACTIVITY_ERROR_CODES.FORBIDDEN, HttpStatus.FORBIDDEN, message);
}

export function activityAlreadyPast(): CodedException {
  return new CodedException(
    ACTIVITY_ERROR_CODES.ALREADY_PAST,
    HttpStatus.CONFLICT,
    'This activity has already ended and can no longer be acted on',
  );
}

export function undoWindowExpired(action: 'restore' | 'undo-decline'): CodedException {
  return new CodedException(
    ACTIVITY_ERROR_CODES.UNDO_WINDOW_EXPIRED,
    HttpStatus.CONFLICT,
    `The ${action === 'restore' ? 'delete' : 'decline'} undo window (5000 ms) has expired`,
  );
}

export function validationFailed(message: string, details?: unknown): CodedException {
  return new CodedException(
    ACTIVITY_ERROR_CODES.VALIDATION_FAILED,
    HttpStatus.UNPROCESSABLE_ENTITY,
    message,
    details,
  );
}
