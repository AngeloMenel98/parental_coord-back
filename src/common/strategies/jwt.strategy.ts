import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../../auth/dto/auth-user.dto';

export interface JwtPayload {
  sub: string;
  email: string;
  systemRole: string;
}

/**
 * Pure mapping from a verified JWT payload to the request-scoped `AuthUser`
 * (design #1471, REQ-1). Shared with the realtime WS auth service so REST and
 * WebSocket handshakes resolve the same user shape from the same token.
 */
export function toAuthUser(payload: JwtPayload): AuthUser {
  return {
    id: payload.sub,
    email: payload.email,
    systemRole: payload.systemRole,
  };
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
