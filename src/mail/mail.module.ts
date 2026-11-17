import { Module } from '@nestjs/common';

import { MailerService } from './mailer.service';

/**
 * Envío de correos (T1).
 *
 * No importa `ConfigModule`: es global (`AppModule`), así que `MailerService` recibe el
 * `ConfigService` ya validado. Tampoco falla al arrancar si no hay SMTP: el error es del
 * envío (502), no del boot (D1).
 */
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailModule {}
