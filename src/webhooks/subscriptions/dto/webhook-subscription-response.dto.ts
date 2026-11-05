import { Exclude, Expose } from 'class-transformer';

/**
 * Vista pública de una suscripción (REQ-SUB-2, AC-2).
 *
 * NUNCA expone el secreto: `secretEncrypted`/`secretPrevEncrypted` no están
 * marcados con `@Expose`, así que `excludeExtraneousValues` los elimina.
 */
@Exclude()
export class WebhookSubscriptionResponseDto {
  @Expose() id!: string;
  @Expose() bondId!: string;
  @Expose() url!: string;
  @Expose() description!: string | null;
  @Expose() eventTypes!: string[];
  @Expose() status!: string;
  @Expose() createdAt!: string;
  @Expose() updatedAt!: string;
}

/**
 * Respuesta de creación/rotación: la vista pública MÁS el secreto en claro,
 * devuelto EXACTAMENTE UNA VEZ (REQ-SUB-2, AC-2). Las lecturas posteriores usan
 * `WebhookSubscriptionResponseDto` y no llevan secreto.
 */
@Exclude()
export class WebhookSubscriptionCreatedDto extends WebhookSubscriptionResponseDto {
  @Expose() secret!: string;
}

/** Respuesta de `POST /subscriptions/:id/rotate-secret` (REQ-SUB-3, AC-3). */
@Exclude()
export class WebhookSecretRotationResponseDto {
  @Expose() id!: string;
  /** Secreto nuevo en claro, mostrado una sola vez. */
  @Expose() secret!: string;
  /** Fin de la ventana de gracia en la que el secreto anterior sigue válido. */
  @Expose() previousSecretExpiresAt!: string;
}
