import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';

import { WEBHOOK_SECRET_PREFIX, WEBHOOK_USER_AGENT } from '../webhooks.constants';

/** Versión del esquema de firma (Standard Webhooks, REQ-SIGN-1). */
export const WEBHOOK_SIGNATURE_VERSION = 'v1';

/** Cabeceras exactas de cada delivery firmado (REQ-SIGN-1/3, AC-12). */
export interface WebhookSignatureHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
  'user-agent': string;
}

/** Quita el prefijo `whsec_` y decodifica la clave HMAC desde base64 (REQ-SIGN-1). */
export function decodeSigningSecret(secret: string): Buffer {
  const raw = secret.startsWith(WEBHOOK_SECRET_PREFIX)
    ? secret.slice(WEBHOOK_SECRET_PREFIX.length)
    : secret;
  return Buffer.from(raw, 'base64');
}

/**
 * Firma Standard Webhooks hecha a mano con `node:crypto` (D5).
 *
 * La firma es `HMAC-SHA256(secret, "{webhook-id}.{webhook-timestamp}.{raw body}")`,
 * base64-encoded y prefijada `v1,`. Durante una rotación (REQ-SIGN-2) se emiten
 * AMBAS firmas —vieja y nueva— separadas por un ESPACIO (formato multi-firma de
 * Standard Webhooks, OQ-A resuelto): `v1,<old> v1,<new>`.
 *
 * Se firma sobre los BYTES EXACTOS que se envían: el llamador pasa el mismo
 * `Buffer` que va en el cuerpo del POST.
 */
@Injectable()
export class SigningService {
  /**
   * Devuelve el valor del header `webhook-signature`. `secrets` puede traer 1
   * (normal) o 2 (rotación en gracia) secretos; el orden se conserva.
   */
  sign(id: string, timestamp: number, rawBody: Buffer, secrets: readonly string[]): string {
    if (secrets.length === 0) {
      throw new Error('At least one signing secret is required');
    }

    const signedContent = Buffer.concat([Buffer.from(`${id}.${timestamp}.`, 'utf8'), rawBody]);

    return secrets
      .map((secret) => `${WEBHOOK_SIGNATURE_VERSION},${this.hmacBase64(signedContent, secret)}`)
      .join(' ');
  }

  /** Arma las cuatro cabeceras obligatorias de un delivery firmado. */
  buildSignatureHeaders(
    id: string,
    timestamp: number,
    rawBody: Buffer,
    secrets: readonly string[],
  ): WebhookSignatureHeaders {
    return {
      'webhook-id': id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': this.sign(id, timestamp, rawBody, secrets),
      'user-agent': WEBHOOK_USER_AGENT,
    };
  }

  private hmacBase64(signedContent: Buffer, secret: string): string {
    return createHmac('sha256', decodeSigningSecret(secret)).update(signedContent).digest('base64');
  }
}
