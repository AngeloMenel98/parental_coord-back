import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `webhook-relay` — AddWebhookTables (design D2, REQ-DATA-1/2, AC-7).
 *
 * Tres tablas nuevas:
 *  - `webhook_subscription` — suscripciones por bond (`bond_id`).
 *  - `webhook_delivery`     — una fila por (evento, suscripción).
 *  - `webhook_delivery_attempt` — un intento por try.
 *
 * Raíces:
 *  - `IF NOT EXISTS` en todo el DDL → migración idempotente.
 *  - Estados como `varchar(20)` + `CHECK` (NO enum nativo: PG no soporta
 *    `CREATE TYPE IF NOT EXISTS`; espeja `outbox_event.event_type varchar(64)`,
 *    design D2).
 *  - Los timestamps de DDL usan `DEFAULT now()` (convención del schema inicial).
 *  - `UNIQUE(event_id, subscription_id)` hace idempotente el fan-out (REQ-DATA-2).
 *  - Las FK encadenan `ON DELETE CASCADE` para que borrar bond/familia purgue
 *    suscripciones → deliveries → attempts y el outbox (REQ-SEC-4); `created_by`
 *    usa `ON DELETE RESTRICT` (no se pierde el rastro del dueño).
 */
export class AddWebhookTables1792454400000 implements MigrationInterface {
  name = 'AddWebhookTables1792454400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "webhook_subscription" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "bond_id" uuid NOT NULL, "created_by" uuid NOT NULL, "url" text NOT NULL, "description" character varying(255), "event_types" text[] NOT NULL DEFAULT '{*}', "secret_encrypted" text NOT NULL, "secret_prev_encrypted" text, "secret_prev_expires_at" TIMESTAMP WITH TIME ZONE, "status" character varying(20) NOT NULL DEFAULT 'ACTIVE', "consecutive_failure_since" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_webhook_subscription_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_webhook_subscription_status" CHECK ("status" IN ('ACTIVE','DISABLED','AUTO_DISABLED')), CONSTRAINT "FK_webhook_subscription_bond" FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE CASCADE, CONSTRAINT "FK_webhook_subscription_created_by" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT)`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "webhook_delivery" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "event_id" uuid NOT NULL, "subscription_id" uuid NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'PENDING', "attempt_count" integer NOT NULL DEFAULT 0, "next_attempt_at" TIMESTAMP WITH TIME ZONE, "last_status_code" integer, "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "completed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_webhook_delivery_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_webhook_delivery_event_sub" UNIQUE ("event_id", "subscription_id"), CONSTRAINT "CHK_webhook_delivery_status" CHECK ("status" IN ('PENDING','RETRYING','SUCCEEDED','FAILED','DEAD')), CONSTRAINT "FK_webhook_delivery_event" FOREIGN KEY ("event_id") REFERENCES "outbox_event"("id") ON DELETE CASCADE, CONSTRAINT "FK_webhook_delivery_subscription" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscription"("id") ON DELETE CASCADE)`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "webhook_delivery_attempt" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "delivery_id" uuid NOT NULL, "attempt_no" integer NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "duration_ms" integer, "status_code" integer, "response_snippet" character varying(1024), "error" text, CONSTRAINT "PK_webhook_delivery_attempt_id" PRIMARY KEY ("id"), CONSTRAINT "FK_webhook_delivery_attempt_delivery" FOREIGN KEY ("delivery_id") REFERENCES "webhook_delivery"("id") ON DELETE CASCADE)`,
    );

    // El relay/reconcile barren `status + next_attempt_at` (REQ-DATA-2).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_webhook_delivery_pending" ON "webhook_delivery" ("status", "next_attempt_at")`,
    );
    // El fan-out filtra suscripciones ACTIVE de un bond (REQ-DATA-2).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_webhook_subscription_bond" ON "webhook_subscription" ("bond_id", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Orden FK-safe: primero los índices, luego attempts → deliveries → subscriptions.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhook_delivery_pending"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhook_subscription_bond"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_delivery_attempt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_delivery"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_subscription"`);
  }
}
