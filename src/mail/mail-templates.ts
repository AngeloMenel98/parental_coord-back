/**
 * El copy de los correos del acceso temporal, en español y en un solo lugar: la
 * instrucción de cambiar la contraseña y el nombre de la app son parte del requisito
 * (S1), no un detalle de formato que cada llamador pueda redactar distinto.
 */

export const APP_NAME = 'Parental Coordination';

/** El contrato mínimo de `MailerService.sendMail`. */
export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

/** `2026-12-12` → `12/12/2026`, sin pasar por `Date`: es una columna `date`, sin zona. */
export function formatAccessEnd(accessEnd: string): string {
  const [year, month, day] = accessEnd.split('-');
  return `${day}/${month}/${year}`;
}

/** Alta de un tercero con email desconocido: usuario + contraseña provisional (D2). */
export function thirdPartyInviteMail(params: {
  email: string;
  password: string;
  accessEnd: string;
}): OutgoingMail {
  return {
    to: params.email,
    subject: `Tu acceso temporal a ${APP_NAME}`,
    text: [
      'Hola:',
      '',
      `Te dieron acceso temporal a ${APP_NAME}.`,
      '',
      `Usuario: ${params.email}`,
      `Contraseña provisional: ${params.password}`,
      `Tu acceso está vigente hasta el ${formatAccessEnd(params.accessEnd)}.`,
      '',
      'Cuando entres por primera vez, la app te va a pedir que cambies la contraseña',
      'provisional por una tuya: elegí una de al menos 8 caracteres, con una letra y un número.',
      '',
      'Si no esperabas este correo, avisale a quien te lo envió.',
    ].join('\n'),
  };
}

/**
 * Aviso para un email que YA tiene cuenta (D2): no toca su contraseña y por eso no
 * lleva credenciales — sólo el alcance del acceso.
 */
export function thirdPartyNoticeMail(params: {
  email: string;
  accessEnd: string;
}): OutgoingMail {
  return {
    to: params.email,
    subject: `Te dieron acceso temporal a ${APP_NAME}`,
    text: [
      'Hola:',
      '',
      `Te dieron acceso temporal a ${APP_NAME} hasta el ${formatAccessEnd(params.accessEnd)}.`,
      '',
      `Entrá con tu usuario de siempre (${params.email}). No cambiamos tu contraseña.`,
      '',
      'Si no esperabas este correo, avisale a quien te lo envió.',
    ].join('\n'),
  };
}
