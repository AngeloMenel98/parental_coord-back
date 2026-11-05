import {
  WEBHOOK_DELIVERY_QUEUE,
  WEBHOOK_DISPATCH_POLL_SCHEDULER_ID,
  WEBHOOK_RECONCILE_SCHEDULER_ID,
  WEBHOOK_RETENTION_SCHEDULER_ID,
  WEBHOOK_USER_AGENT,
  WebhookJobName,
} from './webhooks.constants';

/**
 * Contrato estable de nombres: cola, jobs, scheduler ids y `User-Agent`.
 * El UA es exacto (REQ-SIGN-3) — un cambio rompe a los receptores.
 */
describe('webhooks.constants', () => {
  it('exposes the exact delivery queue name', () => {
    expect(WEBHOOK_DELIVERY_QUEUE).toBe('webhook-delivery');
  });

  it('exposes the exact User-Agent', () => {
    expect(WEBHOOK_USER_AGENT).toBe('CoparentAgenda-Webhooks/1.0');
  });

  it('exposes the four job names', () => {
    expect(WebhookJobName.DELIVERY).toBe('delivery');
    expect(WebhookJobName.DISPATCH_POLL).toBe('dispatch-poll');
    expect(WebhookJobName.RECONCILE).toBe('reconcile');
    expect(WebhookJobName.RETENTION).toBe('retention');
    expect(Object.values(WebhookJobName)).toHaveLength(4);
  });

  it('exposes the three scheduler ids', () => {
    expect(WEBHOOK_DISPATCH_POLL_SCHEDULER_ID).toBe('webhooks-dispatch-poll');
    expect(WEBHOOK_RECONCILE_SCHEDULER_ID).toBe('webhooks-reconcile');
    expect(WEBHOOK_RETENTION_SCHEDULER_ID).toBe('webhooks-retention');
  });
});
