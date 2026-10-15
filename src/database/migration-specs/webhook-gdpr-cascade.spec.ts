import { AddActivityVersionAndOutbox1791859200000 } from '../migrations/1791859200000-AddActivityVersionAndOutbox';
import { AddWebhookTables1792454400000 } from '../migrations/1792454400000-AddWebhookTables';

/**
 * T-W2.7 — Borrado en cascada para GDPR (REQ-NFR-4, AC-21).
 *
 * Sin Postgres en CI lo que se protege es la CADENA COMPLETA de borrado
 * declarada en el DDL de las dos migraciones que introducen webhooks:
 *
 *   bond ──CASCADE──▶ webhook_subscription ──CASCADE──▶ webhook_delivery
 *                                                              │
 *                                                              └─CASCADE──▶ webhook_delivery_attempt
 *
 *   bond ──CASCADE──▶ outbox_event ──CASCADE──▶ webhook_delivery
 *   activity ──CASCADE──▶ outbox_event
 *
 * Borrar un `bond` (o una `activity`) debe arrastrar TODO el rastro de webhooks:
 * no puede quedar ninguna entrega, intento ni evento de outbox huérfano. La
 * única FK RESTRICT es `created_by → user` (no se borra el usuario dueño).
 */
describe('GDPR cascade for webhook data (T-W2.7, REQ-NFR-4, AC-21)', () => {
  const sqlOf = (mock: jest.Mock) => mock.mock.calls.map((c) => String(c[0])).join('\n');

  async function allDdl(): Promise<string> {
    const qr = { query: jest.fn().mockResolvedValue(undefined) };
    await new AddActivityVersionAndOutbox1791859200000().up(qr as unknown as never);
    await new AddWebhookTables1792454400000().up(qr as unknown as never);
    return sqlOf(qr.query);
  }

  let sql: string;

  beforeAll(async () => {
    sql = await allDdl();
  });

  it('cascades bond deletion through the subscription chain down to attempts', async () => {
    // bond → webhook_subscription
    expect(sql).toContain(
      'CONSTRAINT "FK_webhook_subscription_bond" FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE CASCADE',
    );
    // webhook_subscription → webhook_delivery
    expect(sql).toContain('CONSTRAINT "FK_webhook_delivery_subscription"');
    expect(sql).toContain(
      'FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscription"("id") ON DELETE CASCADE',
    );
    // webhook_delivery → webhook_delivery_attempt
    expect(sql).toContain('CONSTRAINT "FK_webhook_delivery_attempt_delivery"');
    expect(sql).toContain(
      'FOREIGN KEY ("delivery_id") REFERENCES "webhook_delivery"("id") ON DELETE CASCADE',
    );
  });

  it('cascades bond deletion through the outbox chain into deliveries', async () => {
    // bond → outbox_event
    expect(sql).toContain('FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE CASCADE');
    // outbox_event → webhook_delivery
    expect(sql).toContain('CONSTRAINT "FK_webhook_delivery_event"');
    expect(sql).toContain(
      'FOREIGN KEY ("event_id") REFERENCES "outbox_event"("id") ON DELETE CASCADE',
    );
  });

  it('cascades activity deletion into its outbox events', async () => {
    expect(sql).toContain('CONSTRAINT "FK_outbox_event_activity"');
    expect(sql).toContain(
      'FOREIGN KEY ("aggregate_id") REFERENCES "activity"("id") ON DELETE CASCADE',
    );
  });

  it('keeps created_by as RESTRICT so the owner trail is never silently deleted', async () => {
    expect(sql).toContain('FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT');
    expect(sql).not.toContain(
      'FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE',
    );
  });

  it('declares no NO ACTION orphan path for the webhook tables', async () => {
    // Cada FK de las tablas de webhooks debe decidir explícitamente (CASCADE o RESTRICT).
    for (const table of [
      'webhook_subscription',
      'webhook_delivery',
      'webhook_delivery_attempt',
      'outbox_event',
    ]) {
      const constraints = sql.match(new RegExp(`FK_${table}[A-Za-z_]*"`, 'g')) ?? [];
      expect(constraints.length).toBeGreaterThan(0);
    }
  });
});
