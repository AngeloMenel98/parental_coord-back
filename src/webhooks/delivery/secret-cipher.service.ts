import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { WEBHOOK_SECRET_PREFIX } from '../webhooks.constants';

/** Algoritmo de cifrado del secreto en reposo (REQ-SEC-2, D5). */
const ALGORITHM = 'aes-256-gcm';
/** Versión del formato serializado (`v1:iv:tag:ct`). */
const FORMAT_VERSION = 'v1';
/** IV aleatorio de 12 bytes (recomendado para GCM). */
const IV_BYTES = 12;
/** AES-256 exige 32 bytes de clave. */
const KEY_BYTES = 32;
/** 32 bytes aleatorios de entropía para el secreto de firma. */
const SECRET_BYTES = 32;

/**
 * Cifra el secreto de firma en reposo con AES-256-GCM (REQ-SEC-2, D5).
 *
 * Formato serializado: `v1:<base64 iv>:<base64 tag>:<base64 ciphertext>`.
 * La clave maestra (`WEBHOOK_SECRET_MASTER_KEY`, base64 de 32 bytes) es OPCIONAL
 * (OQ-D): su ausencia NO impide el arranque; se falla de forma LAZY al primer
 * `encrypt`/`decrypt`, con un error claro. El secreto NUNCA debe aparecer en logs.
 */
@Injectable()
export class SecretCipherService {
  constructor(private readonly config: ConfigService) {}

  /** Genera un secreto de firma nuevo: `whsec_` + base64(32 bytes aleatorios). */
  generateSecret(): string {
    return WEBHOOK_SECRET_PREFIX + randomBytes(SECRET_BYTES).toString('base64');
  }

  /** Cifra un secreto en claro y devuelve `v1:iv:tag:ct` en base64. */
  encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      FORMAT_VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  /** Descifra un valor `v1:iv:tag:ct`; verifica el tag GCM (lanza si fue alterado). */
  decrypt(stored: string): string {
    const key = this.getKey();
    const parts = stored.split(':');
    if (parts.length !== 4) {
      throw new Error('Malformed encrypted secret: expected 4 colon-separated parts');
    }
    const [version, ivB64, tagB64, ciphertextB64] = parts;
    if (version !== FORMAT_VERSION) {
      throw new Error(`Unsupported encrypted secret format version: "${version}"`);
    }

    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  /**
   * Resuelve la clave maestra de forma LAZY (OQ-D). No se valida en el ctor para
   * no romper el arranque en dev; el error se emite sólo cuando se usa el cifrado.
   */
  private getKey(): Buffer {
    const masterKey = this.config.get<string>('WEBHOOK_SECRET_MASTER_KEY');
    if (!masterKey) {
      throw new Error(
        'WEBHOOK_SECRET_MASTER_KEY is not configured — cannot encrypt/decrypt webhook secrets',
      );
    }

    const key = Buffer.from(masterKey, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `WEBHOOK_SECRET_MASTER_KEY must be base64-encoded 32 bytes (got ${key.length} bytes)`,
      );
    }
    return key;
  }
}
