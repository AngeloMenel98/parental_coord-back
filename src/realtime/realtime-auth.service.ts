import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as http from 'http';

import { toAuthUser, JwtPayload } from '../common/strategies/jwt.strategy';
import { AuthUser } from '../auth/dto/auth-user.dto';

/** Minimal shape of the handshake request we care about (design #1471, REQ-1). */
type HandshakeRequest = Pick<http.IncomingMessage, 'headers'>;

/**
 * WebSocket handshake authenticator (REQ-1, design #1471).
 *
 * Verifies the `Authorization: Bearer <jwt>` header of the upgrade request
 * with the SAME contract as `JwtStrategy` — same secret (JwtModule configured
 * from the identical factory as `auth.module.ts`), same payload shape, same
 * `toAuthUser` mapping — so REST and WS resolve the same user from the same
 * token. Query-param tokens (`?token=`) are excluded in v1 (spec REQ-1).
 *
 * Failure policy: returns `null` for a missing/malformed/invalid/expired
 * token; NEVER throws (the gateway maps `null` to close code 4401).
 */
@Injectable()
export class RealtimeAuthService {
  constructor(private readonly jwtService: JwtService) {}

  async authenticate(request: HandshakeRequest): Promise<AuthUser | null> {
    const header = request.headers.authorization;
    if (!header) return null;

    const match = /^Bearer (.+)$/i.exec(header.trim());
    if (!match) return null;

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(match[1]);
      return toAuthUser(payload);
    } catch {
      return null;
    }
  }
}
