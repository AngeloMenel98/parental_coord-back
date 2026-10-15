import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ActivityEntity } from '../../activities/entities/activity.entity';
import { ActivitiesRepository } from '../../activities/repositories/activities.repository';
import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';

/** Tope duro del cuerpo (REQ-DISP-5): 64 KB. */
export const MAX_WEBHOOK_PAYLOAD_BYTES = 64 * 1024;

/** Fallback si `WEBHOOK_API_VERSION` no está configurado (D12). */
export const DEFAULT_WEBHOOK_API_VERSION = '2026-10-01';

/** `data.transition` — sólo la info de la transición (REQ-DISP-5). */
export interface WebhookTransition {
  from: string;
  to: string;
  actor: string;
  reason?: string;
}

/** `data.activity` — snapshot estático de la fila + overrides event-consistentes. */
export interface WebhookActivitySnapshot {
  id: string;
  familyId: string;
  title: string;
  state: string;
  assigneeId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  responseDeadlineAt: string | null;
  deleted: boolean;
  version: number;
}

/** Forma PRD §7.2 (REQ-DISP-5, AC-11). */
export interface WebhookPayload {
  id: string;
  type: string;
  apiVersion: string;
  occurredAt: string;
  data: {
    activity: WebhookActivitySnapshot;
    transition: WebhookTransition;
  };
}

export interface BuildWebhookPayloadInput {
  /** `webhook-id` estable = `outbox_event.id` (OQ-E). */
  id: string;
  type: string;
  /** `outbox_event.aggregate_id` (id de la activity). */
  activityId: string;
  bondId: string;
  aggregateVersion: number;
  createdAt: Date;
  payload: Record<string, unknown>;
  activity: ActivityEntity | null;
  apiVersion: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function buildSnapshot(input: BuildWebhookPayloadInput): WebhookActivitySnapshot {
  const raw = input.payload;
  const activity = input.activity;

  return {
    id: activity?.id ?? input.activityId,
    // `familyId` = `bond_id` (Q7): el payload usa "family", el dominio usa "bond".
    familyId: activity?.bondId ?? input.bondId,
    title: activity?.title ?? '',
    // OVERRIDE: la fila viva puede ser más nueva; el estado es el del evento.
    state: asString(raw.to) ?? activity?.status ?? '',
    assigneeId: activity?.assignedTo ?? null,
    scheduledStart: isoOrNull(activity?.scheduledStart),
    scheduledEnd: isoOrNull(activity?.scheduledEnd),
    responseDeadlineAt: isoOrNull(activity?.deadline),
    // `deleted` se lleva desde el payload; el logo de soft-delete también lo implica.
    deleted: raw.deleted === true || activity?.deletedAt != null,
    // OVERRIDE: versión consistente con el evento, no con la fila viva.
    version: input.aggregateVersion,
  };
}

function buildTransition(raw: Record<string, unknown>): WebhookTransition {
  const reason = asString(raw.reason);
  const transition: WebhookTransition = {
    from: asString(raw.from) ?? '',
    to: asString(raw.to) ?? '',
    actor: asString(raw.actor) ?? '',
  };
  if (reason !== undefined) {
    transition.reason = reason;
  }
  return transition;
}

/**
 * Guarda el tope de 64 KB sobre el cuerpo exacto que se va a enviar (REQ-DISP-5).
 * Lanza si se excede: el intento quedará registrado como fallo, nunca se trunca
 * silenciosamente un payload firmado (el receptor debe recibir exactamente lo firmado).
 */
export function assertPayloadWithinLimit(payload: WebhookPayload): void {
  const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (size > MAX_WEBHOOK_PAYLOAD_BYTES) {
    throw new Error(
      `Webhook payload is ${size} bytes, exceeding the ${MAX_WEBHOOK_PAYLOAD_BYTES}-byte (64 KB) limit`,
    );
  }
}

/**
 * Constructor PURO del payload (REQ-DISP-5, D4). No toca el outbox: recibe la
 * fila de `activity` ya leída (soft-delete-inclusive) y produce el snapshot:
 *  - estáticos (title, scheduled*, assigneeId, familyId) desde la fila;
 *  - `state` = `payload.to` y `version` = `aggregate_version` (override);
 *  - `deleted` desde `payload.deleted`;
 *  - `requiresVerification`/`renewalDate` NO existen pre-verify → se omiten.
 */
export function buildWebhookPayload(input: BuildWebhookPayloadInput): WebhookPayload {
  const raw = input.payload;
  const payload: WebhookPayload = {
    id: input.id,
    type: input.type,
    apiVersion: input.apiVersion,
    occurredAt: asString(raw.occurredAt) ?? input.createdAt.toISOString(),
    data: {
      activity: buildSnapshot(input),
      transition: buildTransition(raw),
    },
  };

  assertPayloadWithinLimit(payload);
  return payload;
}

/**
 * Servicio del payload builder (D4). Lee el snapshot con una consulta
 * SOFT-DELETE-INCLUSIVE (`findByIdIncludingDeleted` NO filtra `deleted_at IS NULL`,
 * REQ-DISP-5) y delega en la función pura. Nunca escribe: conserva la invariante
 * write-only del outbox (REQ-DATA-3).
 */
@Injectable()
export class WebhookPayloadBuilder {
  constructor(
    private readonly activitiesRepo: ActivitiesRepository,
    private readonly config: ConfigService,
  ) {}

  async build(event: OutboxEventEntity): Promise<WebhookPayload> {
    const activity = await this.activitiesRepo.findByIdIncludingDeleted(event.aggregateId);

    return buildWebhookPayload({
      id: event.id,
      type: event.eventType,
      activityId: event.aggregateId,
      bondId: event.bondId,
      aggregateVersion: event.aggregateVersion,
      createdAt: event.createdAt,
      payload: event.payload,
      activity,
      apiVersion: this.config.get<string>('WEBHOOK_API_VERSION') ?? DEFAULT_WEBHOOK_API_VERSION,
    });
  }
}
