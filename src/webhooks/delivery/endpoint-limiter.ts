import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Cap por defecto de requests concurrentes por endpoint (REQ-DEL-5, OQ-B). */
export const DEFAULT_ENDPOINT_CONCURRENCY = 5;

/**
 * Host de un endpoint (clave del semáforo). Incluye el puerto; una URL inválida
 * se usa tal cual como clave para no agrupar destinos distintos por error.
 */
export function endpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Semáforo async PROCESS-LOCAL por host de endpoint (REQ-DEL-5, OQ-B, D6).
 *
 * Limita cuántos requests concurrentes salen hacia cada host para que un receptor
 * lento no ahogue al resto. Es deliberadamente local al proceso: con N réplicas
 * del worker el cap efectivo se multiplica por N (aceptado para v1, documentado
 * en OQ-B).
 *
 * La lógica es pura (sin I/O) y se testea sin contenedor Nest.
 */
@Injectable()
export class EndpointLimiter {
  private readonly cap: number;
  private readonly active = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();

  constructor(private readonly config: ConfigService) {
    const configured = this.config.get<number>('WEBHOOK_ENDPOINT_CONCURRENCY');
    this.cap = configured != null && configured > 0 ? configured : DEFAULT_ENDPOINT_CONCURRENCY;
  }

  /** Cap configurado (visible para tests/observabilidad). */
  get limit(): number {
    return this.cap;
  }

  /** Slots actualmente ocupados para un host (visible para tests). */
  activeCount(host: string): number {
    return this.active.get(host) ?? 0;
  }

  /** Ejecuta `task` respetando el cap del host; libera el slot siempre. */
  async run<T>(host: string, task: () => Promise<T>): Promise<T> {
    const release = await this.acquire(host);
    try {
      return await task();
    } finally {
      release();
    }
  }

  private acquire(host: string): Promise<() => void> {
    const current = this.active.get(host) ?? 0;
    if (current < this.cap) {
      this.active.set(host, current + 1);
      return Promise.resolve(this.makeReleaser(host));
    }
    return new Promise<() => void>((resolve) => {
      const waiters = this.waiters.get(host) ?? [];
      waiters.push(() => resolve(this.makeReleaser(host)));
      this.waiters.set(host, waiters);
    });
  }

  private makeReleaser(host: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      // Hand-off: si hay un waiter, el slot pasa directo (no se decrementa).
      const waiters = this.waiters.get(host);
      const next = waiters?.shift();
      if (next) {
        next();
        return;
      }
      const current = this.active.get(host) ?? 1;
      this.active.set(host, Math.max(current - 1, 0));
    };
  }
}
