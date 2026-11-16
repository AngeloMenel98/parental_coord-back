import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import type { OutgoingMail } from './mail-templates';

/** Puerto SMTP por defecto: 587 (STARTTLS), el que documenta D1. */
const DEFAULT_SMTP_PORT = 587;

/** `http://localhost:587` en una variable mal copiada tampoco es un puerto válido. */
function toPort(raw: string | number | undefined): number {
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_SMTP_PORT;
}

/** `${SMTP_HOST:-}` de docker-compose llega como `''`, no como `undefined`. */
function toOptionalString(raw: string | undefined): string | undefined {
  const value = typeof raw === 'string' ? raw.trim() : raw;
  return value ? value : undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Envío de correos (S1, D1).
 *
 * La configuración SMTP es **opcional a propósito**: la app tiene que arrancar y pasar su
 * validación de config sin SMTP (D1: las claves viven en el `.env` que no se commitea).
 * Sin configuración, [sendMail] falla con un `ServiceUnavailableException` (502) explícito
 * en vez de fingir que mandó algo — el alta de un tercero con email desconocido depende de
 * ese error para revertir la cuenta que creó.
 *
 * La contraseña de la app SMTP NUNCA se loguea: los mensajes de error llevan el
 * destinatario, que es lo único que hace falta para diagnosticar un rebote.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly host?: string;
  private readonly port: number;
  private readonly user?: string;
  private readonly pass?: string;
  private readonly from?: string;
  private transport?: ReturnType<typeof nodemailer.createTransport>;

  constructor(config: ConfigService) {
    this.host = toOptionalString(config.get<string>('SMTP_HOST'));
    this.user = toOptionalString(config.get<string>('SMTP_USER'));
    this.pass = toOptionalString(config.get<string>('SMTP_PASS'));
    this.port = toPort(config.get<string | number>('SMTP_PORT'));
    // Gmail exige que el remitente sea la misma cuenta autenticada: si `MAIL_FROM` no
    // está, `SMTP_USER` es el remitente correcto (y no una cadena vacía).
    this.from = toOptionalString(config.get<string>('MAIL_FROM')) ?? this.user;
  }

  /** ¿Hay SMTP utilizable? Host + credenciales; el remitente cae a `SMTP_USER`. */
  isConfigured(): boolean {
    return Boolean(this.host && this.user && this.pass);
  }

  /**
   * Envía un correo de texto plano.
   *
   * @throws ServiceUnavailableException (502) si el SMTP no está configurado o si el
   * transporte rechaza el envío. El llamante de un flujo transaccional tiene que dejar
   * que ese error revierta lo que estaba por commitear.
   */
  async sendMail(mail: OutgoingMail): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'El envío de correos no está configurado: faltan SMTP_HOST, SMTP_USER o SMTP_PASS.',
      );
    }

    try {
      await this.transport$().sendMail({ from: this.from, ...mail });
      this.logger.log(`Correo enviado a ${mail.to}`);
    } catch (error) {
      // El destinatario sí; la contraseña de la app, jamás: este log queda en producción.
      this.logger.error(`No se pudo enviar el correo a ${mail.to}: ${describeError(error)}`);
      throw new ServiceUnavailableException(
        `No se pudo enviar el correo a ${mail.to}. Intentá de nuevo más tarde.`,
      );
    }
  }

  /** Un solo transporte para todo el proceso (nodemailer mantiene el pool). */
  private transport$(): ReturnType<typeof nodemailer.createTransport> {
    if (!this.transport) {
      this.transport = nodemailer.createTransport({
        host: this.host,
        port: this.port,
        secure: false, // 587 = STARTTLS; 465 sería `secure: true`
        auth: { user: this.user, pass: this.pass },
      });
    }
    return this.transport;
  }
}
