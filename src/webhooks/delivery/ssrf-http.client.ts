import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as dnsPromises } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type {
  Dispatcher,
  RequestInit as UndiciRequestInit,
  Response as UndiciResponse,
} from 'undici';

/** Máx bytes de cuerpo de respuesta que se leen (el log guarda ≤1 KB; REQ-SEC-5). */
export const MAX_SSRF_RESPONSE_BYTES = 64 * 1024;

/** Default del timeout de entrega (D12). */
const DEFAULT_DELIVERY_TIMEOUT_MS = 10_000;

/** Token DI del resolutor DNS (seam inyectable para tests sin red). */
export const SSRF_DNS_RESOLVER = Symbol('SSRF_DNS_RESOLVER');
/** Token DI del fetch (seam inyectable para tests sin red). */
export const SSRF_FETCH = Symbol('SSRF_FETCH');

export type DnsResolver = (hostname: string) => Promise<LookupAddress[]>;
export type SsrfFetch = (input: string, init: UndiciRequestInit) => Promise<UndiciResponse>;

const defaultDnsResolver: DnsResolver = (hostname) => dnsPromises.lookup(hostname, { all: true });

/** Resultado normalizado de un POST; nunca lanza por red/SSRF (el llamador clasifica). */
export interface SsrfHttpResult {
  /** Código HTTP, o `null` si no hubo respuesta (bloqueo/red/timeout). */
  status: number | null;
  /** Cuerpo leído (≤ {@link MAX_SSRF_RESPONSE_BYTES}); vacío si no hubo respuesta. */
  body: string;
  /** `true` si el request se bloqueó por SSRF (IP privada/link-local/metadata, no-HTTPS). */
  blocked: boolean;
  /** `true` si falló a nivel de red/timeout. */
  networkError: boolean;
  error: string | null;
  /**
   * Delay (ms) indicado por la cabecera `Retry-After`, o `null`. Lo consume la
   * `backoffStrategy` para honrar `429`/`503` (REQ-DEL-2).
   */
  retryAfterMs: number | null;
}

/**
 * Convierte `Retry-After` a delay en ms (REQ-DEL-2). Acepta delta-seconds
 * (`"60"`) o HTTP-date (`"Wed, 21 Oct 2026 07:28:00 GMT"`); un valor vencido o
 * inválido → `null` (se usa el schedule FR-22).
 */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  const delta = dateMs - nowMs;
  return delta > 0 ? delta : 0;
}

interface ReadableLike {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(reason?: unknown): Promise<void>;
  };
}

/**
 * Rangos IPv4/IPv6 prohibidos (REQ-SEC-1, D7).
 * Se bloquea el conjunto de RFC1918 + loopback + link-local (incluida la
 * metadata `169.254.169.254`) + CGNAT + benchmark + reservados/multicast, y en
 * IPv6 loopback/unspecified/ULA (`fc00::/7`)/link-local (`fe80::/10`) + IPv4-mapped
 * + la metadata `fd00:ec2::254`. Entrada no-IP → FAIL CLOSED.
 */
export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return isBlockedIpv4(ip.split('.').map(Number));
  }
  if (family === 6) {
    // `expandIpv6` devuelve 8 grupos de 16 bits (no bytes): las máscaras de
    // abajo operan sobre esos grupos.
    const groups = expandIpv6(ip);
    if (!groups) return true;

    // ::ffff:a.b.c.d — IPv4-mapped: valídalo como IPv4 embebido.
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
      return isBlockedIpv4([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]);
    }
    // :: (unspecified) y ::1 (loopback).
    if (groups.every((g) => g === 0)) return true;
    if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;
    // fc00::/7 (ULA) — cubre fd00::/8, incluida la metadata AWS fd00:ec2::254.
    if ((groups[0] & 0xfe00) === 0xfc00) return true;
    // fe80::/10 (link-local).
    if ((groups[0] & 0xffc0) === 0xfe80) return true;
    return false;
  }
  // No es una IP: fail closed.
  return true;
}

function isBlockedIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 (CGNAT)
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 (benchmark)
  if (a >= 224) return true; // 224/4 multicast + 240/4 reservado
  return false;
}

/** Expande una IPv6 (con `::`, zona `%` y cola IPv4 embebida) a 8 grupos u16. */
function expandIpv6(ip: string): number[] | null {
  const zone = ip.indexOf('%');
  const addr = zone === -1 ? ip : ip.slice(0, zone);
  const halves = addr.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (section: string): number[] | null => {
    if (section === '') return [];
    const out: number[] = [];
    for (const group of section.split(':')) {
      if (group.includes('.')) {
        const octets = group.split('.').map(Number);
        if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
          return null;
        }
        out.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
        out.push(parseInt(group, 16));
      }
    }
    return out;
  };

  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1 && head.length !== 8) return null;

  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * Cliente HTTP SSRF-safe sobre `undici` (REQ-SEC-1, AC-17, D7).
 *
 * Por cada request: exige HTTPS, resuelve el host y valida TODAS las IPs
 * (fail-closed), y fija la conexión al set validado vía un `Agent` con
 * `connect.lookup` (evita DNS-rebinding entre resolve y connect). Re-resuelve en
 * CADA entrega (nunca cachea) — es el re-chequeo de delivery-time. No sigue
 * redirects (`redirect:'manual'`; un 3xx se devuelve como respuesta y el
 * clasificador lo trata como terminal). Aplica el timeout de entrega.
 *
 * `dnsResolver` y `fetchFn` son seams inyectables: en tests se stubbean DNS y HTTP
 * sin tocar la red real.
 */
@Injectable()
export class SsrfHttpClient {
  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(SSRF_DNS_RESOLVER)
    private readonly dnsResolver: DnsResolver = defaultDnsResolver,
    @Optional()
    @Inject(SSRF_FETCH)
    private readonly fetchFn: SsrfFetch = undiciFetch,
  ) {}

  async post(
    url: string,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<SsrfHttpResult> {
    const target = this.parseTarget(url);
    if ('blockedReason' in target) {
      return blockedResult(target.blockedReason);
    }

    const addresses = await this.resolveAndValidate(target);
    if ('blockedReason' in addresses) {
      return blockedResult(addresses.blockedReason);
    }
    if ('networkError' in addresses) {
      return networkErrorResult(addresses.networkError);
    }

    const timeoutMs =
      this.config.get<number>('WEBHOOK_DELIVERY_TIMEOUT_MS') ?? DEFAULT_DELIVERY_TIMEOUT_MS;
    const dispatcher = this.buildPinnedAgent(addresses.addresses, timeoutMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        body: rawBody,
        headers,
        redirect: 'manual',
        dispatcher,
        signal: controller.signal,
      });
      const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after') ?? null);
      const body = await readCappedBody(response, MAX_SSRF_RESPONSE_BYTES);
      return {
        status: response.status,
        body,
        blocked: false,
        networkError: false,
        error: null,
        retryAfterMs,
      };
    } catch (error) {
      const message = controller.signal.aborted ? 'Request timed out' : errorMessage(error);
      return networkErrorResult(message);
    } finally {
      clearTimeout(timer);
      await dispatcher.close().catch(() => undefined);
    }
  }

  private parseTarget(
    url: string,
  ): { hostname: string; isHttps: true } | { blockedReason: string } {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { blockedReason: `Invalid endpoint URL: ${url}` };
    }
    if (parsed.protocol !== 'https:') {
      return { blockedReason: 'Only HTTPS endpoints are allowed' };
    }
    // El hostname de una IPv6 literal viene entre corchetes.
    const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
    return { hostname, isHttps: true };
  }

  private async resolveAndValidate(target: {
    hostname: string;
  }): Promise<
    { addresses: LookupAddress[] } | { blockedReason: string } | { networkError: string }
  > {
    let addresses: LookupAddress[];

    const literalFamily = isIP(target.hostname);
    if (literalFamily !== 0) {
      addresses = [{ address: target.hostname, family: literalFamily }];
    } else {
      try {
        addresses = await this.dnsResolver(target.hostname);
      } catch (error) {
        return { networkError: `DNS resolution failed: ${errorMessage(error)}` };
      }
    }

    if (!addresses || addresses.length === 0) {
      return { networkError: `DNS resolution returned no addresses for ${target.hostname}` };
    }

    const blockedAddress = addresses.find((entry) => isBlockedIp(entry.address));
    if (blockedAddress) {
      return { blockedReason: `Blocked non-public address: ${blockedAddress.address}` };
    }

    return { addresses };
  }

  private buildPinnedAgent(addresses: LookupAddress[], timeoutMs: number): Dispatcher {
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options && options.all) {
        callback(null, addresses);
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    };

    return new Agent({
      connect: { lookup, timeout: timeoutMs },
      connectTimeout: timeoutMs,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
  }
}

function blockedResult(error: string): SsrfHttpResult {
  return { status: null, body: '', blocked: true, networkError: false, error, retryAfterMs: null };
}

function networkErrorResult(error: string): SsrfHttpResult {
  return { status: null, body: '', blocked: false, networkError: true, error, retryAfterMs: null };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Lee el cuerpo hasta `maxBytes` sin cargar respuestas gigantes en memoria. */
async function readCappedBody(response: UndiciResponse, maxBytes: number): Promise<string> {
  const body = response.body as unknown as ReadableLike | null;
  if (!body || typeof body.getReader !== 'function') {
    return (await response.text()).slice(0, maxBytes);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
        if (total >= maxBytes) break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(chunks).toString('utf8').slice(0, maxBytes);
}
