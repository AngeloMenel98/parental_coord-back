import { Logger } from '@nestjs/common';
import { OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import * as http from 'http';
import { WebSocket } from 'ws';

import { AuthUser } from '../auth/dto/auth-user.dto';
import { BondsService } from '../bonds/bonds.service';
import { BondMembersRepository } from '../bonds/repositories/bond-members.repository';
import { ActivityChangedMessageV1 } from './dto/activity-changed-message';
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
 * in-memory `Map<userId, Set<WebSocket>>`. Delivery: each subscriber frame is
 * resolved against `BondMembersRepository.findActiveMemberIds(bondId)` and
 * sent ONLY to the sockets of those users, exactly once per socket (sockets
 * are deduplicated via an intermediate Set).
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

  /** Sends the frame only to active members' sockets, exactly once each (REQ-3). */
  private async deliver(message: ActivityChangedMessageV1): Promise<void> {
    try {
      const memberIds = await this.bondMembersRepo.findActiveMemberIds(message.bondId);

      // Intermediate Set → a socket is sent to exactly once even if the query
      // ever returned duplicate user ids.
      const targets = new Set<WebSocket>();
      for (const userId of memberIds) {
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
