import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { Queue } from 'bullmq';

import { AuthUser } from '../../auth/dto/auth-user.dto';
import { WEBHOOK_DELIVERY_QUEUE, WebhookJobName } from '../webhooks.constants';
import { PRODUCED_ACTIVITY_EVENT_TYPES, WEBHOOK_VIRTUAL_EVENT_TYPE } from '../events/event-catalog';
import { SecretCipherService } from '../delivery/secret-cipher.service';
import { WebhookDeliveryJobData } from '../delivery/delivery.job';
import {
  WebhookSubscriptionEntity,
  WebhookSubscriptionStatus,
} from '../subscriptions/entities/webhook-subscription.entity';
import {
  WEBHOOK_WILDCARD,
  WebhookSubscriptionRepository,
} from '../subscriptions/repositories/webhook-subscription.repository';
import { CreateWebhookSubscriptionDto } from '../subscriptions/dto/create-webhook-subscription.dto';
import { UpdateWebhookSubscriptionDto } from '../subscriptions/dto/update-webhook-subscription.dto';
import {
  WebhookSecretRotationResponseDto,
  WebhookSubscriptionCreatedDto,
  WebhookSubscriptionResponseDto,
} from '../subscriptions/dto/webhook-subscription-response.dto';
import { WebhookAuthzService } from '../subscriptions/webhook-authz.service';
import { WEBHOOK_AUDIT_ACTIONS, WebhooksAuditRepository } from '../admin/webhooks-audit.repository';

/** Tope por defecto de suscripciones por bond (REQ-SUB-6, D12). */
export const DEFAULT_WEBHOOK_MAX_PER_BOND = 10;
/** Gracia por defecto de la rotación en horas (REQ-SUB-3, D12). */
export const DEFAULT_WEBHOOK_ROTATION_GRACE_HOURS = 24;

/**
 * Valida que `url` sea una URL absoluta con esquema HTTPS (REQ-SEC-1, AC-17).
 *
 * Se re-comprueba aquí aunque el DTO use `@IsUrl`: la creación y la entrega son
 * dos puntos independientes y HTTPS-only es un requisito duro.
 */
export function assertHttpsUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('url must be a valid absolute URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new BadRequestException('url must use the https scheme');
  }
}

/**
 * Normaliza y valida `eventTypes` (REQ-EVT-1, AC-21).
 *
 * Sin valor ⇒ `['*']`. Cada entrada debe ser un tipo producido, el catch-all
 * virtual `activity.state_changed` o el comodín `*`; un tipo desconocido ⇒ 400.
 * Deduplica conservando el orden.
 */
export function normalizeEventTypes(eventTypes?: readonly string[]): string[] {
  if (!eventTypes || eventTypes.length === 0) return [WEBHOOK_WILDCARD];

  const allowed = new Set<string>([
    ...PRODUCED_ACTIVITY_EVENT_TYPES,
    WEBHOOK_VIRTUAL_EVENT_TYPE,
    WEBHOOK_WILDCARD,
  ]);
  for (const type of eventTypes) {
    if (!allowed.has(type)) {
      throw new BadRequestException(`Unknown event type "${type}"`);
    }
  }
  return [...new Set(eventTypes)];
}

/**
 * Gestión de suscripciones bond-scoped (REQ-SUB-1..6, AC-1/2/3/4/6, D8).
 *
 * El secreto se genera y cifra en el servidor, y sólo se devuelve UNA VEZ en la
 * creación/rotación (REQ-SUB-2). Las mutaciones se auditan (REQ-SUB-6). El tope
 * de 10 por bond se comprueba ANTES de insertar (REQ-SUB-6).
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly subscriptions: WebhookSubscriptionRepository,
    private readonly cipher: SecretCipherService,
    private readonly authz: WebhookAuthzService,
    private readonly audit: WebhooksAuditRepository,
    private readonly config: ConfigService,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly queue: Queue<WebhookDeliveryJobData>,
  ) {}

  /** Crea una suscripción y devuelve su secreto en claro UNA VEZ (AC-1/AC-2). */
  async create(
    bondId: string,
    dto: CreateWebhookSubscriptionDto,
    user: AuthUser,
  ): Promise<WebhookSubscriptionCreatedDto> {
    await this.authz.assertCanManage(bondId, user);
    assertHttpsUrl(dto.url);
    const eventTypes = normalizeEventTypes(dto.eventTypes);

    const count = await this.subscriptions.countByBond(bondId);
    const max = this.maxPerBond();
    if (count >= max) {
      throw new ConflictException(`Bond already has the maximum of ${max} webhook subscriptions`);
    }

    const secret = this.cipher.generateSecret();
    const entity = await this.subscriptions.createAndSave({
      bondId,
      createdBy: user.id,
      url: dto.url,
      description: dto.description ?? null,
      eventTypes,
      secretEncrypted: this.cipher.encrypt(secret),
      status: WebhookSubscriptionStatus.ACTIVE,
      secretPrevEncrypted: null,
      secretPrevExpiresAt: null,
      consecutiveFailureSince: null,
    });

    await this.audit.record({
      bondId,
      userId: user.id,
      entityId: entity.id,
      action: WEBHOOK_AUDIT_ACTIONS.CREATE,
      newValue: { url: entity.url, eventTypes: entity.eventTypes },
    });

    return plainToInstance(
      WebhookSubscriptionCreatedDto,
      { ...entity, secret },
      { excludeExtraneousValues: true },
    );
  }

  /** Lista todas las suscripciones del bond (lectura abierta a miembros, AC-6). */
  async list(bondId: string, user: AuthUser): Promise<WebhookSubscriptionResponseDto[]> {
    await this.authz.assertCanRead(bondId, user);
    const subs = await this.subscriptions.findByWhere({ bondId }, { order: { createdAt: 'ASC' } });
    return plainToInstance(WebhookSubscriptionResponseDto, subs, {
      excludeExtraneousValues: true,
    });
  }

  /** Detalle de una suscripción del bond (sin secreto, REQ-SUB-2). */
  async get(bondId: string, id: string, user: AuthUser): Promise<WebhookSubscriptionResponseDto> {
    await this.authz.assertCanRead(bondId, user);
    const entity = await this.findInBond(bondId, id);
    return plainToInstance(WebhookSubscriptionResponseDto, entity, {
      excludeExtraneousValues: true,
    });
  }

  /** Actualiza url/eventTypes/description/status y audita el cambio (AC-6). */
  async update(
    bondId: string,
    id: string,
    dto: UpdateWebhookSubscriptionDto,
    user: AuthUser,
  ): Promise<WebhookSubscriptionResponseDto> {
    await this.authz.assertCanManage(bondId, user);
    const entity = await this.findInBond(bondId, id);

    const oldValue = {
      url: entity.url,
      eventTypes: entity.eventTypes,
      description: entity.description,
      status: entity.status,
    };

    const patch: Partial<WebhookSubscriptionEntity> = {};
    if (dto.url !== undefined) {
      assertHttpsUrl(dto.url);
      patch.url = dto.url;
    }
    if (dto.eventTypes !== undefined) {
      patch.eventTypes = normalizeEventTypes(dto.eventTypes);
    }
    if (dto.description !== undefined) {
      patch.description = dto.description;
    }
    if (dto.status !== undefined) {
      if (
        dto.status !== WebhookSubscriptionStatus.ACTIVE &&
        dto.status !== WebhookSubscriptionStatus.DISABLED
      ) {
        throw new BadRequestException('status must be ACTIVE or DISABLED');
      }
      patch.status = dto.status;
    }

    const updated = await this.subscriptions.updateEntity(id, patch);

    const newValue = {
      url: updated.url,
      eventTypes: updated.eventTypes,
      description: updated.description,
      status: updated.status,
    };
    const action =
      dto.status === WebhookSubscriptionStatus.DISABLED
        ? WEBHOOK_AUDIT_ACTIONS.DISABLE
        : dto.status === WebhookSubscriptionStatus.ACTIVE &&
            oldValue.status !== WebhookSubscriptionStatus.ACTIVE
          ? WEBHOOK_AUDIT_ACTIONS.ENABLE
          : WEBHOOK_AUDIT_ACTIONS.UPDATE;

    await this.audit.record({
      bondId,
      userId: user.id,
      entityId: id,
      action,
      oldValue,
      newValue,
    });

    return plainToInstance(WebhookSubscriptionResponseDto, updated, {
      excludeExtraneousValues: true,
    });
  }

  /** Elimina una suscripción (cascada a entregas/intentos) y audita (AC-6). */
  async remove(bondId: string, id: string, user: AuthUser): Promise<void> {
    await this.authz.assertCanManage(bondId, user);
    const entity = await this.findInBond(bondId, id);
    await this.subscriptions.removeEntity(id);
    await this.audit.record({
      bondId,
      userId: user.id,
      entityId: id,
      action: WEBHOOK_AUDIT_ACTIONS.DELETE,
      oldValue: { url: entity.url, status: entity.status },
    });
  }

  /**
   * Rota el secreto con ventana de gracia (REQ-SUB-3, AC-3): el secreto actual
   * pasa a `secretPrevEncrypted` con `secretPrevExpiresAt = now + gracia` y se
   * emite uno nuevo, devuelto en claro UNA VEZ.
   */
  async rotateSecret(
    bondId: string,
    id: string,
    user: AuthUser,
  ): Promise<WebhookSecretRotationResponseDto> {
    await this.authz.assertCanManage(bondId, user);
    const entity = await this.findInBond(bondId, id);

    const secret = this.cipher.generateSecret();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.rotationGraceHours() * 3_600_000);

    await this.subscriptions.updateEntity(id, {
      secretPrevEncrypted: entity.secretEncrypted,
      secretPrevExpiresAt: expiresAt,
      secretEncrypted: this.cipher.encrypt(secret),
    });

    await this.audit.record({
      bondId,
      userId: user.id,
      entityId: id,
      action: WEBHOOK_AUDIT_ACTIONS.ROTATE,
      newValue: { previousSecretExpiresAt: expiresAt.toISOString() },
    });

    return plainToInstance(
      WebhookSecretRotationResponseDto,
      { id, secret, previousSecretExpiresAt: expiresAt.toISOString() },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Encola un ping de prueba `webhook.test` al endpoint (REQ-SUB-4, AC-4).
   *
   * Reutiliza el job `delivery` con la marca `test` (no hay `outbox_event`, así
   * que no se crea fila de entrega): el worker arma el payload de prueba, lo
   * firma y lo POSTea por el cliente SSRF-safe.
   */
  async test(bondId: string, id: string, user: AuthUser): Promise<{ queued: boolean }> {
    await this.authz.assertCanManage(bondId, user);
    await this.findInBond(bondId, id);

    await this.queue.add(
      WebhookJobName.DELIVERY,
      { eventId: '', subscriptionId: id, test: true },
      {
        jobId: `test--${id}--${Date.now()}`,
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 3600 },
      },
    );

    return { queued: true };
  }

  private async findInBond(bondId: string, id: string): Promise<WebhookSubscriptionEntity> {
    const entity = await this.subscriptions.findById(id);
    if (!entity || entity.bondId !== bondId) {
      throw new NotFoundException(`Webhook subscription "${id}" not found`);
    }
    return entity;
  }

  private maxPerBond(): number {
    return this.config.get<number>('WEBHOOK_MAX_PER_BOND') ?? DEFAULT_WEBHOOK_MAX_PER_BOND;
  }

  private rotationGraceHours(): number {
    return (
      this.config.get<number>('WEBHOOK_ROTATION_GRACE_HOURS') ??
      DEFAULT_WEBHOOK_ROTATION_GRACE_HOURS
    );
  }
}
