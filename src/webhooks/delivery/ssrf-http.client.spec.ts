import { ConfigService } from '@nestjs/config';
import type { LookupAddress } from 'node:dns';

import {
  SsrfHttpClient,
  isBlockedIp,
  parseRetryAfter,
  type DnsResolver,
  type SsrfFetch,
} from './ssrf-http.client';

function config(timeout = 10_000): ConfigService {
  return { get: jest.fn().mockReturnValue(timeout) } as unknown as ConfigService;
}

const dns = (addresses: LookupAddress[]): jest.MockedFunction<DnsResolver> =>
  jest.fn().mockResolvedValue(addresses) as jest.MockedFunction<DnsResolver>;

function response(
  status: number,
  textValue = 'ok',
  body?: unknown,
  headers?: Record<string, string>,
) {
  return {
    status,
    body: body ?? null,
    text: jest.fn().mockResolvedValue(textValue),
    headers: headers ? { get: (name: string) => headers[name.toLowerCase()] ?? null } : undefined,
  };
}

describe('isBlockedIp (REQ-SEC-1, AC-17, D7)', () => {
  it.each([
    ['10.0.0.5'],
    ['10.255.255.255'],
    ['127.0.0.1'],
    ['0.0.0.0'],
    ['169.254.169.254'], // cloud metadata
    ['169.254.1.1'],
    ['172.16.0.1'],
    ['172.31.255.255'],
    ['192.168.1.1'],
    ['100.64.0.1'], // CGNAT
    ['192.0.0.1'],
    ['198.18.0.1'], // benchmark
    ['224.0.0.1'], // multicast
    ['255.255.255.255'], // reserved
    ['::1'],
    ['::'],
    ['fc00::1'], // ULA
    ['fd12:3456::1'],
    ['fd00:ec2::254'], // AWS IPv6 metadata
    ['fe80::1'], // link-local
    ['::ffff:10.0.0.5'], // IPv4-mapped private
    ['::ffff:169.254.169.254'],
    ['not-an-ip'], // fail closed
    [''],
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['93.184.216.34'],
    ['142.250.0.1'],
    ['2606:4700:4700::1111'],
    ['::ffff:8.8.8.8'], // IPv4-mapped public
  ])('allows %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe('parseRetryAfter (REQ-DEL-2)', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');

  it('parses delta-seconds', () => {
    expect(parseRetryAfter('60', now)).toBe(60_000);
    expect(parseRetryAfter('0', now)).toBe(0);
  });

  it('parses an HTTP-date into a positive delta', () => {
    expect(parseRetryAfter('Thu, 15 Oct 2026 12:01:00 GMT', now)).toBe(60_000);
  });

  it('returns null for absent/invalid values', () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('', now)).toBeNull();
    expect(parseRetryAfter('not-a-date', now)).toBeNull();
  });

  it('clamps a past HTTP-date to 0', () => {
    expect(parseRetryAfter('Thu, 15 Oct 2026 11:59:00 GMT', now)).toBe(0);
  });
});

describe('SsrfHttpClient.post (REQ-SEC-1, AC-17)', () => {
  it('rejects non-HTTPS endpoints as blocked (no DNS, no fetch)', async () => {
    const dnsStub = dns([]);
    const fetchStub = jest.fn() as unknown as jest.MockedFunction<SsrfFetch>;
    const client = new SsrfHttpClient(config(), dnsStub, fetchStub);

    const result = await client.post('http://example.com/hook', Buffer.from('{}'), {});

    expect(result.blocked).toBe(true);
    expect(result.error).toMatch(/HTTPS/);
    expect(dnsStub).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('blocks when ANY resolved address is private', async () => {
    const dnsStub = dns([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    const fetchStub = jest.fn() as unknown as jest.MockedFunction<SsrfFetch>;
    const client = new SsrfHttpClient(config(), dnsStub, fetchStub);

    const result = await client.post('https://evil.example/hook', Buffer.from('{}'), {});

    expect(result.blocked).toBe(true);
    expect(result.error).toContain('10.0.0.5');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('blocks an IP-literal metadata endpoint without DNS', async () => {
    const dnsStub = dns([]);
    const fetchStub = jest.fn() as unknown as jest.MockedFunction<SsrfFetch>;
    const client = new SsrfHttpClient(config(), dnsStub, fetchStub);

    const result = await client.post(
      'https://169.254.169.254/latest/meta-data',
      Buffer.from('{}'),
      {},
    );

    expect(result.blocked).toBe(true);
    expect(dnsStub).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('posts to a public endpoint with redirect:manual and a pinned dispatcher', async () => {
    const dnsStub = dns([{ address: '93.184.216.34', family: 4 }]);
    const fetchStub = jest
      .fn()
      .mockResolvedValue(response(200, '{"ok":true}')) as unknown as jest.MockedFunction<SsrfFetch>;
    const client = new SsrfHttpClient(config(), dnsStub, fetchStub);

    const result = await client.post('https://receiver.example/hook', Buffer.from('{"a":1}'), {
      'content-type': 'application/json',
    });

    expect(result).toEqual({
      status: 200,
      body: '{"ok":true}',
      blocked: false,
      networkError: false,
      error: null,
      retryAfterMs: null,
    });

    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe('https://receiver.example/hook');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.dispatcher).toBeDefined();
    expect(init.signal).toBeDefined();
  });

  it('surfaces a Retry-After header as retryAfterMs', async () => {
    const dnsStub = dns([{ address: '93.184.216.34', family: 4 }]);
    const fetchStub = jest
      .fn()
      .mockResolvedValue(
        response(429, '', undefined, { 'retry-after': '60' }),
      ) as unknown as jest.MockedFunction<SsrfFetch>;
    const client = new SsrfHttpClient(config(), dnsStub, fetchStub);

    const result = await client.post('https://receiver.example/hook', Buffer.from('{}'), {});

    expect(result.status).toBe(429);
    expect(result.retryAfterMs).toBe(60_000);
  });

  it('does NOT follow redirects: a 302 is returned as a response', async () => {
    const dnsStub = dns([{ address: '93.184.216.34', family: 4 }]);
    const fetchStub = jest
      .fn()
      .mockResolvedValue(response(302, '')) as unknown as jest.MockedFunction<SsrfFetch>;
    const client = new SsrfHttpClient(config(), dnsStub, fetchStub);

    const result = await client.post('https://receiver.example/hook', Buffer.from('{}'), {});

    expect(result.status).toBe(302);
    expect(result.networkError).toBe(false);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('re-resolves DNS on every delivery and blocks a rebinding host (delivery-time re-check)', async () => {
    const dnsStub = jest
      .fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([
        { address: '169.254.169.254', family: 4 },
      ]) as jest.MockedFunction<DnsResolver>;
    const fetchStub = jest
      .fn()
      .mockResolvedValue(response(200)) as unknown as jest.MockedFunction<SsrfFetch>;
    const client = new SsrfHttpClient(config(), dnsStub, fetchStub);

    const first = await client.post('https://rebind.example/hook', Buffer.from('{}'), {});
    const second = await client.post('https://rebind.example/hook', Buffer.from('{}'), {});

    expect(first.status).toBe(200);
    expect(second.blocked).toBe(true);
    expect(dnsStub).toHaveBeenCalledTimes(2);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('returns a networkError result (never throws) when the fetch rejects', async () => {
    const dnsStub = dns([{ address: '93.184.216.34', family: 4 }]);
    const fetchStub = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as jest.MockedFunction<SsrfFetch>;
    const client = new SsrfHttpClient(config(), dnsStub, fetchStub);

    const result = await client.post('https://receiver.example/hook', Buffer.from('{}'), {});

    expect(result.status).toBeNull();
    expect(result.networkError).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('returns a networkError result when DNS returns no addresses', async () => {
    const dnsStub = dns([]);
    const fetchStub = jest.fn() as unknown as jest.MockedFunction<SsrfFetch>;
    const client = new SsrfHttpClient(config(), dnsStub, fetchStub);

    const result = await client.post('https://empty.example/hook', Buffer.from('{}'), {});

    expect(result.networkError).toBe(true);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
