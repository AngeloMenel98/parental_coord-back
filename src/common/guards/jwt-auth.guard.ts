import { ForbiddenException, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { AuthUser } from '../../auth/dto/auth-user.dto';
import { ALLOW_DURING_PASSWORD_CHANGE } from '../decorators/allow-during-password-change.decorator';

/** Código estable del 403; el cliente ramifica por `code`, no por el texto. */
export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED';

/**
 * JWT + candado del cambio obligatorio (S2).
 *
 * Primero autentica como siempre (passport). Después, si el token trae
 * `mustChangePassword: true`, toda ruta responde 403 `PASSWORD_CHANGE_REQUIRED` salvo
 * las marcadas con `@AllowDuringPasswordChange()` —hoy `change-password` y `me`—, que son
 * justamente las que permiten salir del estado.
 *
 * Un token SIN la claim se trata como `false`: los tokens emitidos antes de esta feature
 * siguen funcionando y las rutas públicas (register/login/health) no pasan por este guard.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = await super.canActivate(context);
    if (!authenticated) return false;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_PASSWORD_CHANGE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (user?.mustChangePassword === true) {
      // Mismo cuerpo que el resto del backend (`HttpExceptionFilter` levanta `code`),
      // así el cliente no tiene que interpretar un texto en español.
      throw new ForbiddenException({
        statusCode: 403,
        code: PASSWORD_CHANGE_REQUIRED,
        message: 'Tenés que cambiar la contraseña antes de seguir: POST /auth/change-password',
        error: 'Forbidden',
      });
    }

    return true;
  }
}
