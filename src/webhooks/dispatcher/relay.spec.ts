import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';
import { OutboxEventRepository } from '../../outbox/repositories/outbox-event.repository';
import { FanOutService } from './fan-out.service';
import { RELAY_BATCH_LIMIT, Relay } from './relay';

function event(id: string): OutboxEventEntity {
  return { id } as unknown as OutboxEventEntity;
}

describe('Relay (T-W1.19, REQ-DISP-1/4, AC-8)', () => {
  let outbox: { findPending: jest.Mock };
  let fanOut: { dispatch: jest.Mock };
  let relay: Relay;

  beforeEach(() => {
    outbox = { findPending: jest.fn().mockResolvedValue([]) };
    fanOut = { dispatch: jest.fn().mockResolvedValue(1) };
    relay = new Relay(
      outbox as unknown as OutboxEventRepository,
      fanOut as unknown as FanOutService,
    );
  });

  it('reads pending events with the default batch limit and fans them out', async () => {
    outbox.findPending.mockResolvedValue([event('e1'), event('e2')]);

    const dispatched = await relay.run();

    expect(outbox.findPending).toHaveBeenCalledWith(RELAY_BATCH_LIMIT);
    expect(fanOut.dispatch).toHaveBeenCalledTimes(2);
    expect(dispatched).toBe(2);
  });

  it('uses an explicit limit when provided', async () => {
    await relay.run(7);
    expect(outbox.findPending).toHaveBeenCalledWith(7);
  });

  it('does nothing when there is no pending event', async () => {
    const dispatched = await relay.run();
    expect(dispatched).toBe(0);
    expect(fanOut.dispatch).not.toHaveBeenCalled();
  });

  it('isolates a per-event failure: the rest of the batch still runs', async () => {
    outbox.findPending.mockResolvedValue([event('e1'), event('e2')]);
    fanOut.dispatch.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(3);

    const dispatched = await relay.run();

    expect(fanOut.dispatch).toHaveBeenCalledTimes(2);
    expect(dispatched).toBe(3);
  });
});
