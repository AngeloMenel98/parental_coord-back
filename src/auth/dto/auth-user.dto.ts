export class AuthUser {
  id!: string;
  email!: string;
  systemRole!: string;

  /**
   * S2 · `true` = la contraseña la generó el sistema y `JwtAuthGuard` sólo deja pasar
   * `change-password` y `me`. Ausente = `false` (tokens anteriores a la feature).
   */
  mustChangePassword?: boolean;
}
