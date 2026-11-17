import 'reflect-metadata';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// El transporte NUNCA es real: este spec no puede abrir una conexión SMTP ni mandar
// un correo de verdad (`createTransport` está mockeado a nivel de módulo).
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

import * as nodemailer from 'nodemailer';

import { validateConfig } from '../config/app-config';
import { MailerService } from './mailer.service';

/** `ConfigService` mínimo: el servicio sólo lee claves planas. */
const config = (values: Record<string, string | number | undefined>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const fullyConfigured = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_USER: 'angelomenel21@gmail.com',
  SMTP_PASS: 'app-password-de-prueba',
  MAIL_FROM: 'Parental Coordination <angelomenel21@gmail.com>',
};

describe('MailerService', () => {
  const transport = { sendMail: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    transport.sendMail.mockResolvedValue({ accepted: ['abuela@example.com'] });
    (nodemailer.createTransport as jest.Mock).mockReturnValue(transport);
  });

  it('sin SMTP configurado la app arranca igual y `sendMail` falla con un 502 claro', async () => {
    // `${SMTP_HOST:-}` de docker-compose llega como cadena vacía, no como `undefined`.
    const service = new MailerService(
      config({ SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: '' }),
    );

    expect(service.isConfigured()).toBe(false);
    await expect(
      service.sendMail({ to: 'abuela@example.com', subject: 'Hola', text: 'Texto' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('el mensaje del 502 dice qué falta y no expone ningún valor de configuración', async () => {
    const service = new MailerService(config({ SMTP_HOST: 'smtp.gmail.com' }));

    const error = await service
      .sendMail({ to: 'abuela@example.com', subject: 'Hola', text: 'Texto' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).message).toContain('SMTP_HOST');
    expect((error as ServiceUnavailableException).message).not.toContain('smtp.gmail.com');
  });

  it('configurado: crea el transporte con host, puerto 587, secure=false y auth', async () => {
    const service = new MailerService(config(fullyConfigured));

    expect(service.isConfigured()).toBe(true);
    await service.sendMail({ to: 'abuela@example.com', subject: 'Asunto', text: 'Texto' });

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: 'angelomenel21@gmail.com', pass: 'app-password-de-prueba' },
    });
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'Parental Coordination <angelomenel21@gmail.com>',
      to: 'abuela@example.com',
      subject: 'Asunto',
      text: 'Texto',
    });
  });

  it('usa SMTP_PORT cuando viene y cae a 587 cuando falta', async () => {
    const service = new MailerService(config({ ...fullyConfigured, SMTP_PORT: '2525' }));
    await service.sendMail({ to: 'abuela@example.com', subject: 'Asunto', text: 'Texto' });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 2525 }),
    );
  });

  it('MAIL_FROM vacío: el remitente es SMTP_USER, no una cadena vacía', async () => {
    const service = new MailerService(config({ ...fullyConfigured, MAIL_FROM: '' }));
    await service.sendMail({ to: 'abuela@example.com', subject: 'Asunto', text: 'Texto' });

    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'angelomenel21@gmail.com' }),
    );
  });

  it('reutiliza un solo transporte para varios envíos', async () => {
    const service = new MailerService(config(fullyConfigured));

    await service.sendMail({ to: 'a@example.com', subject: 'A', text: 'A' });
    await service.sendMail({ to: 'b@example.com', subject: 'B', text: 'B' });

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    expect(transport.sendMail).toHaveBeenCalledTimes(2);
  });

  it('si el envío falla: 502, log con el destinatario y NUNCA la contraseña', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    transport.sendMail.mockRejectedValue(new Error('Invalid login: 535-5.7.8 auth rejected'));
    const service = new MailerService(config(fullyConfigured));

    await expect(
      service.sendMail({ to: 'abuela@example.com', subject: 'Asunto', text: 'Texto' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(logged).toHaveBeenCalledTimes(1);
    const line = String(logged.mock.calls[0][0]);
    expect(line).toContain('abuela@example.com');
    expect(line).not.toContain('app-password-de-prueba');
    logged.mockRestore();
  });
});

/**
 * D1: las cinco claves SMTP son opcionales. Si alguna fuera obligatoria, el back no
 * arrancaría sin `.env` SMTP y el fallo llegaría como un crash de config en vez del
 * 502 explicativo del alta de terceros.
 */
describe('AppConfig — claves SMTP opcionales (D1)', () => {
  const required = {
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USER: 'u',
    DB_PASSWORD: 'p',
    DB_NAME: 'd',
    JWT_SECRET: 's',
  };

  it('valida sin ninguna clave SMTP', () => {
    const cfg = validateConfig({ ...required });

    expect(cfg.SMTP_HOST).toBeUndefined();
    expect(cfg.SMTP_PORT).toBeUndefined();
    expect(cfg.SMTP_USER).toBeUndefined();
    expect(cfg.SMTP_PASS).toBeUndefined();
    expect(cfg.MAIL_FROM).toBeUndefined();
  });

  it('valida con las claves vacías que inyecta docker-compose', () => {
    const cfg = validateConfig({
      ...required,
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      MAIL_FROM: '',
    });

    // Cadena vacía = ausente; el puerto no puede quedar en 0 y romper la validación.
    expect(cfg.SMTP_PORT).toBeUndefined();
    expect(cfg.SMTP_HOST).toBe('');
  });

  it('coerciona SMTP_PORT a número y rechaza un puerto inválido', () => {
    expect(validateConfig({ ...required, SMTP_PORT: '587' }).SMTP_PORT).toBe(587);
    expect(() => validateConfig({ ...required, SMTP_PORT: 'abc' })).toThrow(
      /Config validation failed/,
    );
  });
});
