import { Injectable, Logger } from '@nestjs/common';

import { OutboxEventRepository } from '../../outbox/repositories/outbox-event.repository';
import { RealtimePublisher } from '../../realtime/realtime-publisher.service';
import { FanOutService } from './fan-out.service';

/** Máximo de eventos de outbox procesados por ciclo de poll (D3). */
export const RELAY_BATCH_LIMIT = 100;

/**
 * Relay del outbox (REQ-DISP-1/4, AC-8, D3).
 *
 * Lee las filas NO despachadas más antiguas, y delega el fan-out de cada una.
 * Un evento que falla se loguea y NO bloquea el resto del lote: el `dispatched_at`
 * sólo se setea cuando el fan-out de ese evento commitea, así que un fallo se
 * reintenta en el próximo poll sin perder nada.
 *
 * Sólo corre en el proceso worker (OQ-C; el scheduler se registra en
 * `RelayScheduler`).
 *
 * Tras un fan-out exitoso publica la señal de realtime (`RealtimePublisher`,
 * REQ-4). La publicación va dentro del MISMO try/catch log-only: el publisher
 * nunca lanza, así que un fallo de realtime no afecta al dispatch de webhooks
 * ni al conteo devuelto por `run`.
 */
@Injectable()
export class Relay {
  private readonly logger = new Logger(Relay.name);

  constructor(
    private readonly outbox: OutboxEventRepository,
    private readonly fanOut: FanOutService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** Procesa hasta `limit` eventos pendientes; devuelve las entregas creadas. */
  async run(limit: number = RELAY_BATCH_LIMIT): Promise<number> {
    const pending = await this.outbox.findPending(limit);
    let dispatched = 0;

    for (const event of pending) {
      try {
        dispatched += await this.fanOut.dispatch(event);
        await this.realtime.publish(event);
      } catch (error) {
        this.logger.error(
          `Fan-out failed for outbox event ${event.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return dispatched;
  }
}
