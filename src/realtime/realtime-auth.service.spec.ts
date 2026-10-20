import { JwtService } from '@nestjs/jwt';
import * as http from 'http';

import { RealtimeAuthService } from './realtime-auth.service';

/** Handshake-request stub carrying only the Authorization header. */
function request(authorization?: string): http.IncomingMessage {
  return { headers: authorization ? { authorization } : {} } as http.IncomingMessage;
}

/** JwtService stub with a controllable `verifyAsync`. */
function jwtService(verifyAsync: jest.Mock): JwtService {
  return { verifyAsync } as unknown as JwtService;
}

const PAYLOAD = { sub: 'u1', email: 'u1@test.dev', systemRole: 'user' };

/**
 * Handshake auth (REQ-1): Bearer header verified with the same contract as
 * JwtStrategy, mapped via `toAuthUser`; null on missing/malformed/invalid.
 */
describe('RealtimeAuthService (REQ-1)', () => {
  it('verifies the Bearer token and maps the payload via toAuthUser', async () => {
    const verifyAsync = jest.fn().mockResolvedValue(PAYLOAD);
    const service = new RealtimeAuthService(jwtService(verifyAsync));

    const user = await service.authenticate(request('Bearer abc.def.ghi'));

    expect(verifyAsync).toHaveBeenCalledTimes(1);
    expect(verifyAsync).toHaveBeenCalledWith('abc.def.ghi');
    expect(user).toEqual({ id: 'u1', email: 'u1@test.dev', systemRole: 'user' });
  });

  it('returns null when the Authorization header is missing', async () => {
    const verifyAsync = jest.fn();
    const service = new RealtimeAuthService(jwtService(verifyAsync));

    await expect(service.authenticate(request())).resolves.toBeNull();
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('returns null when the header is not a Bearer scheme', async () => {
    const verifyAsync = jest.fn();
    const service = new RealtimeAuthService(jwtService(verifyAsync));

    await expect(service.authenticate(request('Basic dXNlcjpwYXNz'))).resolves.toBeNull();
    await expect(service.authenticate(request('Bearer'))).resolves.toBeNull();
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('returns null when the token is invalid or expired (never throws)', async () => {
    const verifyAsync = jest.fn().mockRejectedValue(new Error('jwt expired'));
    const service = new RealtimeAuthService(jwtService(verifyAsync));

    await expect(service.authenticate(request('Bearer stale.token'))).resolves.toBeNull();
  });

  it('tolerates surrounding whitespace in the header', async () => {
    const verifyAsync = jest.fn().mockResolvedValue(PAYLOAD);
    const service = new RealtimeAuthService(jwtService(verifyAsync));

    const user = await service.authenticate(request('  Bearer abc.def.ghi  '));

    expect(user?.id).toBe('u1');
    expect(verifyAsync).toHaveBeenCalledWith('abc.def.ghi');
  });
});
