import { Logger } from '@nestjs/common';
import { OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import * as http from 'http';
import { WebSocket } from 'ws';

import { AuthUser } from '../auth/dto/auth-user.dto';
import { BondsService } from '../bonds/bonds.service';
import { BondMembersRepository } from '../bonds/repositories/bond-members.repository';
import { ActivityChangedMessageV1 } from './dto/activity-changed-message';
import { ExpenseChangedMessageV1 } from './dto/expense-changed-message';
import { NotificationCreatedMessageV1 } from './dto/notification-created-message';
import { RealtimeMessageV1 } from './dto/realtime-message';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeSubscriberService } from './realtime-subscriber.service';
import { WS_CLOSE_NO_MEMBERSHIP, WS_CLOSE_UNAUTHORIZED } from './realtime.constants';

/**
 * API-side realtime gateway (REQ-1/REQ-3, design #1471).
 *
 * Native WebSocket endpoint (platform-ws, NO Socket.IO). The path is the
 * STATIC `WS_PATH` env (default `/realtime`) captured at import time — an
 * accepted v1 limitation (design open question): the decorator options are
 * evaluated before Nest DI boots. The endpoint does NOT go through the global
 * `api` HTTP prefix.
 *
 * Handshake: `handleConnection(client, request)` reads the upgrade request
 * from the SECOND argument (`WsAdapter` emits `('connection', ws, request)`)
 * — NOT `client.upgradeReq`, which does not exist in ws@8. Missing/invalid
 * token → close 4401; valid token but no active bond membership
 * (`BondsService.findByUserId` empty) → close 4403 (spec REQ-1).
 *
 * Registry: platform-ws offers NO rooms/namespaces, so the "room" is an
 * in-memory `Map<userId, Set<WebSocket>>`. Delivery is per frame TYPE:
 * `activity.changed` resolves its audience from the bond's active members,
 * while `notification.created` is already addressed to one user and goes only
 * to that user's sockets (with the `userId` routing key stripped).
 */
@WebSocketGateway({ path: process.env.WS_PATH ?? '/realtime' })
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly registry = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly authService: RealtimeAuthService,
    private readonly bondsService: BondsService,
    private readonly bondMembersRepo: BondMembersRepository,
    private readonly subscriber: RealtimeSubscriberService,
  ) {}

  afterInit(): void {
    this.subscriber.messages$.subscribe((message) => {
      void this.deliver(message);
    });
  }

  /**
   * Authenticates the upgrade and registers the socket under its user.
   * `request` is the 2nd argument of the `connection` event (ws@8 + platform-ws).
   */
  async handleConnection(client: WebSocket, request: http.IncomingMessage): Promise<void> {
    try {
      const user: AuthUser | null = await this.authService.authenticate(request);
      if (!user) {
        client.close(WS_CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }

      const bonds = await this.bondsService.findByUserId(user.id);
      if (bonds.length === 0) {
        client.close(WS_CLOSE_NO_MEMBERSHIP, 'no active bond membership');
        return;
      }

      let sockets = this.registry.get(user.id);
      if (!sockets) {
        sockets = new Set();
        this.registry.set(user.id, sockets);
      }
      sockets.add(client);
    } catch (error) {
      // A failed handshake lookup must never take the API process down with
      // an unhandled rejection; close with the standard internal-error code.
      this.logger.error(
        `WS connection handling failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      client.close(1011, 'internal error');
    }
  }

  handleDisconnect(client: WebSocket): void {
    for (const [userId, sockets] of this.registry) {
      if (!sockets.delete(client)) continue;
      if (sockets.size === 0) this.registry.delete(userId);
      return;
    }
  }

  /** Routes a frame by type: bond audience for activities, one user for notifications. */
  private async deliver(message: RealtimeMessageV1): Promise<void> {
    if (message.type === 'notification.created') {
      this.deliverToUser(message);
      return;
    }
    await this.deliverToBond(message);
  }

  /**
   * Sends a notification frame only to the owner's sockets, in-process (no DB
   * lookup: the frame already names its recipient).
   *
   * The `userId` routing key is stripped before the write — every socket only
   * ever sees the frame addressed to itself.
   */
  private deliverToUser(message: NotificationCreatedMessageV1): void {
    const { userId, ...frame } = message;
    const raw = JSON.stringify(frame);
    for (const socket of this.registry.get(userId) ?? []) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(raw);
      }
    }
  }

  /** Sends a bond-scoped frame only to active members' sockets, exactly once each (REQ-3). */
  private async deliverToBond(
    message: ActivityChangedMessageV1 | ExpenseChangedMessageV1,
  ): Promise<void> {
    try {
      const memberIds = await this.bondMembersRepo.findActiveMemberIds(message.bondId);

      // T6/S9 — el tercero temporal NO recibe el stream del vínculo: se lo saca del
      // broadcast general y sólo se le entrega lo que es suyo. Sin este filtro, un
      // `expense.changed` o la actividad de otra persona le llegaba igual.
      const thirdPartyIds = new Set(
        await this.bondMembersRepo.findActiveThirdPartyIds(message.bondId),
      );

      // Intermediate Set → a socket is sent to exactly once even if the query
      // ever returned duplicate user ids.
      const targets = new Set<WebSocket>();
      for (const userId of memberIds) {
        if (thirdPartyIds.has(userId) && !isFrameForThirdParty(message, userId)) continue;
        for (const socket of this.registry.get(userId) ?? []) {
          targets.add(socket);
        }
      }

      const raw = JSON.stringify(message);
      for (const socket of targets) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(raw);
        }
      }
    } catch (error) {
      this.logger.error(
        `Realtime delivery failed for bond ${message.bondId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/**
 * ¿Este frame le corresponde a un tercero temporal? (T6/S9/S12)
 *
 * Sólo los frames de actividades **asignadas a él**. Un frame sin `assignedTo` no se le
 * entrega: ante la duda, no filtrar de menos. Los `expense.changed` nunca pasan por acá
 * positivamente — el saldo del hogar no es suyo (S5).
 */
function isFrameForThirdParty(
  message: ActivityChangedMessageV1 | ExpenseChangedMessageV1,
  userId: string,
): boolean {
  return (
    message.type === 'activity.changed' &&
    (message as ActivityChangedMessageV1).assignedTo === userId
  );
}
