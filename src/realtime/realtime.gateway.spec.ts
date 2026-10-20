import { Subject } from 'rxjs';
import { WebSocket } from 'ws';

import { BondsService } from '../bonds/bonds.service';
import { BondMembersRepository } from '../bonds/repositories/bond-members.repository';
import { ActivityChangedMessageV1 } from './dto/activity-changed-message';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeSubscriberService } from './realtime-subscriber.service';
import { WS_CLOSE_NO_MEMBERSHIP, WS_CLOSE_UNAUTHORIZED } from './realtime.constants';

/** Mocked client socket (platform-ws hands us a raw `ws` socket). */
function clientSocket(): WebSocket & { close: jest.Mock; send: jest.Mock } {
  return {
    readyState: 1, // WebSocket.OPEN
    close: jest.fn(),
    send: jest.fn(),
  } as unknown as WebSocket & { close: jest.Mock; send: jest.Mock };
}

function handshakeRequest(authorization?: string): import('http').IncomingMessage {
  return {
    headers: authorization ? { authorization } : {},
  } as import('http').IncomingMessage;
}

function frame(bondId: string): ActivityChangedMessageV1 {
  return {
    v: 1,
    type: 'activity.changed',
    eventId: `evt-${bondId}-${Math.random().toString(36).slice(2, 8)}`,
    activityId: 'a1',
    bondId,
    from: 'assigned',
    to: 'assisting',
    actor: { type: 'user', id: 'u1', role: 'child' },
    occurredAt: '2026-10-16T14:22:31.412Z',
  };
}

/** Lets the fire-and-forget `deliver()` promise settle before asserting. */
function flushDelivery(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Gateway (REQ-1/REQ-3): 4401 missing/invalid token, 4403 without active
 * membership, `Map<userId, Set<WebSocket>>` registry (platform-ws has NO
 * rooms), and selective delivery — only active members' sockets, exactly once
 * per socket. Subscriber is a controllable Subject stub; e2e with a real
 * server lands in batch 5.
 */
describe('RealtimeGateway (REQ-1/REQ-3)', () => {
  let authService: { authenticate: jest.Mock };
  let bondsService: { findByUserId: jest.Mock };
  let bondMembersRepo: { findActiveMemberIds: jest.Mock };
  let subscriber: { messages$: Subject<ActivityChangedMessageV1> };
  let gateway: RealtimeGateway;

  beforeEach(() => {
    authService = { authenticate: jest.fn() };
    bondsService = { findByUserId: jest.fn() };
    bondMembersRepo = { findActiveMemberIds: jest.fn() };
    subscriber = { messages$: new Subject<ActivityChangedMessageV1>() };
    gateway = new RealtimeGateway(
      authService as unknown as RealtimeAuthService,
      bondsService as unknown as BondsService,
      bondMembersRepo as unknown as BondMembersRepository,
      subscriber as unknown as RealtimeSubscriberService,
    );
    gateway.afterInit();
  });

  describe('handshake (REQ-1)', () => {
    it('closes with 4401 when the token is missing (authenticate → null)', async () => {
      authService.authenticate.mockResolvedValue(null);
      const socket = clientSocket();

      await gateway.handleConnection(socket, handshakeRequest());

      expect(socket.close).toHaveBeenCalledWith(WS_CLOSE_UNAUTHORIZED, expect.any(String));
      expect(bondsService.findByUserId).not.toHaveBeenCalled();
    });

    it('closes with 4401 when the token is invalid (authenticate → null)', async () => {
      authService.authenticate.mockResolvedValue(null);
      const socket = clientSocket();

      await gateway.handleConnection(socket, handshakeRequest('Bearer bad.token'));

      expect(socket.close).toHaveBeenCalledWith(WS_CLOSE_UNAUTHORIZED, expect.any(String));
    });

    it('closes with 4403 when the user has no active bond membership', async () => {
      authService.authenticate.mockResolvedValue({ id: 'u1', email: 'e', systemRole: 'user' });
      bondsService.findByUserId.mockResolvedValue([]);
      const socket = clientSocket();

      await gateway.handleConnection(socket, handshakeRequest('Bearer ok'));

      expect(bondsService.findByUserId).toHaveBeenCalledWith('u1');
      expect(socket.close).toHaveBeenCalledWith(WS_CLOSE_NO_MEMBERSHIP, expect.any(String));
      expect(socket.send).not.toHaveBeenCalled();
    });

    it('registers the socket under its userId when authenticated with memberships', async () => {
      authService.authenticate.mockResolvedValue({ id: 'u1', email: 'e', systemRole: 'user' });
      bondsService.findByUserId.mockResolvedValue([{ id: 'b1' }]);
      bondMembersRepo.findActiveMemberIds.mockResolvedValue(['u1']);
      const socket = clientSocket();

      await gateway.handleConnection(socket, handshakeRequest('Bearer ok'));
      subscriber.messages$.next(frame('b1'));
      await flushDelivery();

      expect(socket.close).not.toHaveBeenCalled();
      expect(socket.send).toHaveBeenCalledTimes(1);
    });

    it('keeps both sockets of the same user registered (multi-tab)', async () => {
      authService.authenticate.mockResolvedValue({ id: 'u1', email: 'e', systemRole: 'user' });
      bondsService.findByUserId.mockResolvedValue([{ id: 'b1' }]);
      bondMembersRepo.findActiveMemberIds.mockResolvedValue(['u1']);
      const first = clientSocket();
      const second = clientSocket();

      await gateway.handleConnection(first, handshakeRequest('Bearer ok'));
      await gateway.handleConnection(second, handshakeRequest('Bearer ok'));
      subscriber.messages$.next(frame('b1'));
      await flushDelivery();

      expect(first.send).toHaveBeenCalledTimes(1);
      expect(second.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnect', () => {
    it('unregisters the socket so it no longer receives frames', async () => {
      authService.authenticate.mockResolvedValue({ id: 'u1', email: 'e', systemRole: 'user' });
      bondsService.findByUserId.mockResolvedValue([{ id: 'b1' }]);
      bondMembersRepo.findActiveMemberIds.mockResolvedValue(['u1']);
      const socket = clientSocket();

      await gateway.handleConnection(socket, handshakeRequest('Bearer ok'));
      gateway.handleDisconnect(socket);
      subscriber.messages$.next(frame('b1'));
      await flushDelivery();

      expect(socket.send).not.toHaveBeenCalled();
    });

    it('does not unregister other sockets of the same user', async () => {
      authService.authenticate.mockResolvedValue({ id: 'u1', email: 'e', systemRole: 'user' });
      bondsService.findByUserId.mockResolvedValue([{ id: 'b1' }]);
      bondMembersRepo.findActiveMemberIds.mockResolvedValue(['u1']);
      const first = clientSocket();
      const second = clientSocket();

      await gateway.handleConnection(first, handshakeRequest('Bearer ok'));
      await gateway.handleConnection(second, handshakeRequest('Bearer ok'));
      gateway.handleDisconnect(first);
      subscriber.messages$.next(frame('b1'));
      await flushDelivery();

      expect(first.send).not.toHaveBeenCalled();
      expect(second.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('selective delivery (REQ-3)', () => {
    /** u1 (2 sockets), u2 (1 socket) and u3 (0 sockets, not connected). */
    async function connectTrio(): Promise<{
      u1a: ReturnType<typeof clientSocket>;
      u1b: ReturnType<typeof clientSocket>;
      u2: ReturnType<typeof clientSocket>;
    }> {
      authService.authenticate.mockImplementation((request: { headers: Record<string, string> }) =>
        Promise.resolve(
          request.headers.authorization === 'Bearer u2'
            ? { id: 'u2', email: 'e2', systemRole: 'user' }
            : { id: 'u1', email: 'e1', systemRole: 'user' },
        ),
      );
      bondsService.findByUserId.mockResolvedValue([{ id: 'b1' }]);

      const u1a = clientSocket();
      const u1b = clientSocket();
      const u2 = clientSocket();
      await gateway.handleConnection(u1a, handshakeRequest('Bearer u1'));
      await gateway.handleConnection(u1b, handshakeRequest('Bearer u1'));
      await gateway.handleConnection(u2, handshakeRequest('Bearer u2'));
      return { u1a, u1b, u2 };
    }

    it('sends only to the sockets of active members, exactly once per socket', async () => {
      const { u1a, u1b, u2 } = await connectTrio();
      bondMembersRepo.findActiveMemberIds.mockResolvedValue(['u1']);

      const message = frame('b1');
      subscriber.messages$.next(message);
      await flushDelivery();

      expect(bondMembersRepo.findActiveMemberIds).toHaveBeenCalledWith('b1');
      const expected = JSON.stringify(message);
      expect(u1a.send).toHaveBeenCalledTimes(1);
      expect(u1a.send).toHaveBeenCalledWith(expected);
      expect(u1b.send).toHaveBeenCalledTimes(1);
      expect(u1b.send).toHaveBeenCalledWith(expected);
      expect(u2.send).not.toHaveBeenCalled();
    });

    it('deduplicates sockets even if the member query returns duplicate ids', async () => {
      const { u1a, u1b } = await connectTrio();
      bondMembersRepo.findActiveMemberIds.mockResolvedValue(['u1', 'u1']);

      subscriber.messages$.next(frame('b1'));
      await flushDelivery();

      expect(u1a.send).toHaveBeenCalledTimes(1);
      expect(u1b.send).toHaveBeenCalledTimes(1);
    });

    it('sends nothing when the bond has no registered sockets', async () => {
      await connectTrio();
      bondMembersRepo.findActiveMemberIds.mockResolvedValue(['u3']);

      subscriber.messages$.next(frame('b1'));
      await flushDelivery();

      // no registered sockets at all → no crash, no sends (already asserted per socket)
      expect(bondMembersRepo.findActiveMemberIds).toHaveBeenCalledTimes(1);
    });

    it('does not send to closed sockets (readyState !== OPEN)', async () => {
      const { u1a } = await connectTrio();
      (u1a as unknown as { readyState: number }).readyState = 3; // WebSocket.CLOSED
      bondMembersRepo.findActiveMemberIds.mockResolvedValue(['u1']);

      subscriber.messages$.next(frame('b1'));
      await flushDelivery();

      expect(u1a.send).not.toHaveBeenCalled();
    });
  });
});
