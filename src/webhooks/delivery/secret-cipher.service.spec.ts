import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { SecretCipherService } from './secret-cipher.service';
import { WEBHOOK_SECRET_PREFIX } from '../webhooks.constants';

const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

async function build(key: string | undefined): Promise<SecretCipherService> {
  const config = { get: jest.fn().mockReturnValue(key) } as unknown as ConfigService;
  const module: TestingModule = await Test.createTestingModule({
    providers: [SecretCipherService, { provide: ConfigService, useValue: config }],
  }).compile();
  return module.get(SecretCipherService);
}

describe('SecretCipherService (REQ-SEC-2, D5, OQ-D)', () => {
  it('round-trips a secret (encrypt → decrypt)', async () => {
    const cipher = await build(VALID_KEY);
    const secret = `${WEBHOOK_SECRET_PREFIX}${Buffer.alloc(32, 1).toString('base64')}`;

    const encrypted = cipher.encrypt(secret);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(encrypted.split(':')).toHaveLength(4);
    expect(cipher.decrypt(encrypted)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV) that still decrypts', async () => {
    const cipher = await build(VALID_KEY);
    const a = cipher.encrypt('whsec_plaintext');
    const b = cipher.encrypt('whsec_plaintext');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('whsec_plaintext');
    expect(cipher.decrypt(b)).toBe('whsec_plaintext');
  });

  it('fails LAZILY with a clear error when the master key is unset (OQ-D)', async () => {
    const cipher = await build(undefined);
    expect(() => cipher.encrypt('whsec_x')).toThrow(/WEBHOOK_SECRET_MASTER_KEY/);
    expect(() => cipher.decrypt('v1:a:b:c')).toThrow(/WEBHOOK_SECRET_MASTER_KEY/);
  });

  it('rejects a master key that is not 32 bytes after base64-decode', async () => {
    const cipher = await build(Buffer.alloc(16, 1).toString('base64'));
    expect(() => cipher.encrypt('whsec_x')).toThrow(/32 bytes/);
  });

  it('rejects malformed stored values', async () => {
    const cipher = await build(VALID_KEY);
    expect(() => cipher.decrypt('not-a-valid-format')).toThrow(/Malformed/);
    expect(() => cipher.decrypt('v2:a:b:c')).toThrow(/Unsupported/);
  });

  it('fails decryption when the ciphertext is tampered (GCM tag)', async () => {
    const cipher = await build(VALID_KEY);
    const [version, iv, tag] = cipher.encrypt('whsec_secret').split(':');
    const tampered = `${version}:${iv}:${tag}:${Buffer.from('other').toString('base64')}`;
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('generates a whsec_ secret that base64-decodes to 32 bytes', async () => {
    const cipher = await build(VALID_KEY);
    const secret = cipher.generateSecret();
    expect(secret.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    expect(Buffer.from(secret.slice(WEBHOOK_SECRET_PREFIX.length), 'base64')).toHaveLength(32);
  });
});
