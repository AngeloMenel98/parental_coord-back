import { SetMetadata } from '@nestjs/common';

/** Clave de metadata que lee `JwtAuthGuard`. */
export const ALLOW_DURING_PASSWORD_CHANGE = 'allowDuringPasswordChange';

/**
 * S2 · marca la ruta como accesible aunque el token diga `mustChangePassword: true`.
 *
 * El candado del `JwtAuthGuard` bloquea el resto con 403 `PASSWORD_CHANGE_REQUIRED`;
 * sólo quedan abiertas las dos rutas sin las cuales el cliente no podría salir del
 * estado: `POST /auth/change-password` y `GET /auth/me` (para saber quién es y qué
 * pantalla mostrar).
 */
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_DURING_PASSWORD_CHANGE, true);
