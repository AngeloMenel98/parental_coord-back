import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../../auth/dto/auth-user.dto';

export interface JwtPayload {
  sub: string;
  email: string;
  systemRole: string;
  /** S2 · `true` ⇒ la contraseña la generó el sistema y hay que cambiarla al entrar. */
  mustChangePassword?: boolean;
}

/**
 * Pure mapping from a verified JWT payload to the request-scoped `AuthUser`
 * (design #1471, REQ-1). Shared with the realtime WS auth service so REST and
 * WebSocket handshakes resolve the same user shape from the same token.
 *
 * S2 keeps the shape backward compatible: the claim is copied ONLY when it is `true`,
 * so a token without it (or with `false`) produces byte-identical output to before and
 * `JwtAuthGuard` reads `undefined` as "no change required".
 */
export function toAuthUser(payload: JwtPayload): AuthUser {
  const user: AuthUser = {
    id: payload.sub,
    email: payload.email,
    systemRole: payload.systemRole,
  };
  if (payload.mustChangePassword === true) user.mustChangePassword = true;
  return user;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    return toAuthUser(payload);
  }
}
