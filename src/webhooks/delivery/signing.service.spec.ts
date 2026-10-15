import { SigningService, decodeSigningSecret } from './signing.service';
import { WEBHOOK_USER_AGENT } from '../webhooks.constants';

/**
 * Vector OFICIAL de Standard Webhooks (README): si esto falla, los receptores que
 * usan librerías estándar rechazarán nuestras firmas (REQ-SIGN-1, AC-12).
 */
const VECTOR = {
  secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
  id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: 1614265330,
  // Bytes EXACTOS (JSON.stringify sin espacios NO es válido aquí).
  body: Buffer.from('{"test": 2432232314}', 'utf8'),
  expected: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
};

describe('decodeSigningSecret (REQ-SIGN-1)', () => {
  it('strips whsec_ and base64-decodes the key', () => {
    expect(decodeSigningSecret(VECTOR.secret).toString('base64')).toBe(
      'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
    );
  });
});

describe('SigningService.sign (REQ-SIGN-1, AC-12)', () => {
  const service = new SigningService();

  it('reproduces the Standard Webhooks test vector', () => {
    expect(service.sign(VECTOR.id, VECTOR.timestamp, VECTOR.body, [VECTOR.secret])).toBe(
      VECTOR.expected,
    );
  });

  it('signs over the EXACT bytes sent (whitespace-sensitive body)', () => {
    const spaced = service.sign(
      VECTOR.id,
      VECTOR.timestamp,
      Buffer.from('{"test": 2432232314}', 'utf8'),
      [VECTOR.secret],
    );
    const compact = service.sign(
      VECTOR.id,
      VECTOR.timestamp,
      Buffer.from('{"test":2432232314}', 'utf8'),
      [VECTOR.secret],
    );
    expect(spaced).not.toBe(compact);
  });

  it('emits the OLD and NEW signatures SPACE-separated during rotation (REQ-SIGN-2, OQ-A)', () => {
    const oldSecret = 'whsec_' + Buffer.alloc(32, 1).toString('base64');
    const newSecret = 'whsec_' + Buffer.alloc(32, 2).toString('base64');

    const header = service.sign('e1', 1700000000, Buffer.from('{}'), [oldSecret, newSecret]);
    const parts = header.split(' ');

    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.startsWith('v1,'))).toBe(true);
    expect(parts[0]).toBe(service.sign('e1', 1700000000, Buffer.from('{}'), [oldSecret]));
    expect(parts[1]).toBe(service.sign('e1', 1700000000, Buffer.from('{}'), [newSecret]));
  });

  it('throws when no secret is provided', () => {
    expect(() => service.sign('e1', 1, Buffer.from('{}'), [])).toThrow(/At least one/);
  });

  it('builds the mandatory headers including the exact User-Agent (REQ-SIGN-3)', () => {
    const headers = service.buildSignatureHeaders(VECTOR.id, VECTOR.timestamp, VECTOR.body, [
      VECTOR.secret,
    ]);

    expect(headers['webhook-id']).toBe(VECTOR.id);
    expect(headers['webhook-timestamp']).toBe(String(VECTOR.timestamp));
    expect(headers['webhook-signature']).toBe(VECTOR.expected);
    expect(headers['user-agent']).toBe(WEBHOOK_USER_AGENT);
    expect(headers['user-agent']).toBe('CoparentAgenda-Webhooks/1.0');
  });
});
