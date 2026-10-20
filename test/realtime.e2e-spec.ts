import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { WsAdapter } from '@nestjs/platform-ws';
import * as http from 'http';
import { Subject } from 'rxjs';
import * as WebSocket from 'ws';

import { RealtimeSubscriberService } from '../src/realtime/realtime-subscriber.service';
import { WS_CLOSE_NO_MEMBERSHIP, WS_CLOSE_UNAUTHORIZED } from '../src/realtime/realtime.constants';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { RealtimeAuthService } from '../src/realtime/realtime-auth.service';
import { BondsService } from '../src/bonds/bonds.service';
import { BondMembersRepository } from '../src/bonds/repositories/bond-members.repository';
import { ActivityChangedMessageV1 } from '../src/realtime/dto/activity-changed-message';

const WS_PATH = process.env.WS_PATH ?? '/realtime';
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

/**
 * Realtime E2E (B5.1): in-process Nest app + WsAdapter + mocked
 * JwtService/BondsService + controllable subscriber stub, driven by a REAL `ws`
 * client. Asserts the handshake close codes (4401/4403) and targeted delivery
 * (only sockets of active members of the message's bondId, once per socket).
 *
 * The gateway resolves recipients through BondMembersRepository, so the mock
 * keys `findActiveMemberIds` by bondId to model soft scoping.
 */
describe('Realtime E2E (B5.1)', () => {
  let app: INestApplication;
  let jwtService: jest.Mock;
  let findByUserId: jest.Mock;
  let findActiveMemberIds: jest.Mock;
  let messages$: Subject<ActivityChangedMessageV1>;
  let wsUrl: string;

  // Payloads queued for the next handshake(s); consumed strictly in order by
  // the mocked verifyAsync.
  let tokenPayloads: Array<Record<string, unknown> | Error>;

  beforeAll(async () => {
    jwtService = jest.fn();
    findByUserId = jest.fn();
    findActiveMemberIds = jest.fn();
    messages$ = new Subject<ActivityChangedMessageV1>();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        RealtimeAuthService,
        { provide: JwtService, useValue: { verifyAsync: jwtService } },
        { provide: BondsService, useValue: { findByUserId } },
        { provide: BondMembersRepository, useValue: { findActiveMemberIds } },
        { provide: RealtimeSubscriberService, useValue: { messages$ } },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
    await app.listen(0);

    const server: http.Server = app.getHttpServer();
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    wsUrl = `ws://127.0.0.1:${port}${WS_PATH}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jwtService.mockReset();
    findByUserId.mockReset();
    findActiveMemberIds.mockReset();
    tokenPayloads = [];
    jwtService.mockImplementation(() => {
      const next = tokenPayloads.shift();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    });
  });

  /** Connects a real ws client and resolves once the socket is OPEN. */
  function connect(token?: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = token
        ? new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${token}` } })
        : new WebSocket(wsUrl);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }

  /** Resolves with the close code when the handshake is rejected. */
  function closeCode(ws: WebSocket): Promise<number> {
    return new Promise((resolve) => ws.once('close', (code: number) => resolve(code)));
  }

  it('closes with 4401 when connecting without an Authorization header', async () => {
    const ws = new WebSocket(wsUrl);
    await expect(closeCode(ws)).resolves.toBe(WS_CLOSE_UNAUTHORIZED);
    expect(jwtService).not.toHaveBeenCalled();
  });

  it('closes with 4401 when the token is invalid/expired', async () => {
    tokenPayloads.push(new Error('jwt expired'));
    const ws = new WebSocket(wsUrl, { headers: { Authorization: 'Bearer bad.token' } });
    await expect(closeCode(ws)).resolves.toBe(WS_CLOSE_UNAUTHORIZED);
    expect(jwtService).toHaveBeenCalledWith('bad.token');
  });

  it('closes with 4403 when the token is valid but the user has no active membership', async () => {
    tokenPayloads.push({ sub: 'u1', email: 'u1@test.dev', systemRole: 'user' });
    findByUserId.mockResolvedValueOnce([]);
    const ws = new WebSocket(wsUrl, { headers: { Authorization: 'Bearer ok' } });
    await expect(closeCode(ws)).resolves.toBe(WS_CLOSE_NO_MEMBERSHIP);
    expect(findByUserId).toHaveBeenCalledWith('u1');
  });

  it('accepts an authenticated member and delivers a frame from its bondid exactly once per socket', async () => {
    tokenPayloads.push({ sub: 'u1', email: 'u1@test.dev', systemRole: 'user' });
    findByUserId.mockResolvedValueOnce([{ id: 'b1' }]);
    findActiveMemberIds.mockResolvedValue(['u1']);

    const ws = await connect('ok');
    const received: string[] = [];
    ws.on('message', (data: WebSocket.RawData) => received.push(data.toString()));

    // allow the async handleConnection registration to complete
    await delay(50);
    messages$.next(frame('b1'));
    await delay(50);

    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0])).toMatchObject({
      v: 1,
      type: 'activity.changed',
      bondId: 'b1',
      from: 'assigned',
      to: 'assisting',
    });
    ws.close();
  });

  it('delivers to every active member of the bond and not to others', async () => {
    // u1 and u2 are active members of b1; u3 is a member of b2 only.
    tokenPayloads.push(
      { sub: 'u1', email: 'u1@test.dev', systemRole: 'user' },
      { sub: 'u2', email: 'u2@test.dev', systemRole: 'user' },
      { sub: 'u3', email: 'u3@test.dev', systemRole: 'user' },
    );
    findByUserId
      .mockResolvedValueOnce([{ id: 'b1' }])
      .mockResolvedValueOnce([{ id: 'b1' }])
      .mockResolvedValueOnce([{ id: 'b2' }]);

    const ws1 = await connect('t1');
    const ws2 = await connect('t2');
    const ws3 = await connect('t3');
    const got1: string[] = [];
    const got2: string[] = [];
    const got3: string[] = [];
    ws1.on('message', (d: WebSocket.RawData) => got1.push(d.toString()));
    ws2.on('message', (d: WebSocket.RawData) => got2.push(d.toString()));
    ws3.on('message', (d: WebSocket.RawData) => got3.push(d.toString()));

    await delay(50);
    // Recipients of b1 = u1, u2 (NOT u3, who is only in b2).
    findActiveMemberIds.mockResolvedValueOnce(['u1', 'u2']);
    messages$.next(frame('b1'));
    await delay(50);

    expect(got1).toHaveLength(1);
    expect(got2).toHaveLength(1);
    expect(got3).toHaveLength(0);
    expect(findActiveMemberIds).toHaveBeenCalledWith('b1');

    ws1.close();
    ws2.close();
    ws3.close();
  });
});
