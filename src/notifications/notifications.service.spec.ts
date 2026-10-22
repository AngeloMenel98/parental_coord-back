import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';

import { AuthUser } from '../auth/dto/auth-user.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { UnreadCountQueryDto } from './dto/unread-count-query.dto';
import { NotificationsService } from './notifications.service';
import { NotificationRepository } from './repositories/notification.repository';

interface SeedRow {
  id: string;
  userId: string;
  bondId: string | null;
  type: string;
  title: string;
  body: string;
  refEntityType: string;
  refEntityId: string | null;
  isRead: boolean;
  createdAt: Date;
}

const CALLER: AuthUser = { id: 'u1', email: 'u1@example.com', systemRole: 'user' };
const OTHER: AuthUser = { id: 'u2', email: 'u2@example.com', systemRole: 'user' };

function row(partial: Partial<SeedRow> & { id: string }): SeedRow {
  return {
    userId: 'u1',
    bondId: 'b1',
    type: 'activity_assigned',
    title: 'Ir al pediatra',
    body: 'New activity assigned: Ir al pediatra',
    refEntityType: 'activity',
    refEntityId: 'a1',
    isRead: false,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    ...partial,
  };
}

/**
 * Doble del repositorio que SIMULA el `WHERE user_id = :userId` (y los filtros
 * opcionales) del SQL real: así el test verifica que el servicio nunca pide
 * filas de otro usuario.
 */
function build(rows: SeedRow[]) {
  const repository = {
    listForUser: jest.fn(
      async (
        userId: string,
        options: { limit: number; offset: number; unreadOnly?: boolean; bondId?: string },
      ) => {
        let filtered = rows.filter((r) => r.userId === userId);
        if (options.unreadOnly) filtered = filtered.filter((r) => !r.isRead);
        if (options.bondId) filtered = filtered.filter((r) => r.bondId === options.bondId);

        const total = filtered.length;
        const items = filtered.slice(options.offset, options.offset + options.limit);
        return { items, total };
      },
    ),
    countUnread: jest.fn(async (userId: string, bondId?: string) => {
      let filtered = rows.filter((r) => r.userId === userId && !r.isRead);
      if (bondId) filtered = filtered.filter((r) => r.bondId === bondId);
      return filtered.length;
    }),
    markRead: jest.fn(async (id: string, userId: string) => {
      const target = rows.find((r) => r.id === id && r.userId === userId);
      if (!target) return 0;
      target.isRead = true;
      return 1;
    }),
    markAllRead: jest.fn(async (userId: string, bondId?: string) => {
      const targets = rows.filter(
        (r) => r.userId === userId && !r.isRead && (!bondId || r.bondId === bondId),
      );
      targets.forEach((r) => {
        r.isRead = true;
      });
      return targets.length;
    }),
  };

  const service = new NotificationsService(repository as unknown as NotificationRepository);
  return { service, repository };
}

describe('NotificationsService (notifications-read-path)', () => {
  it('returns only the caller notifications (foreign rows are absent from items and total)', async () => {
    const { service, repository } = build([
      row({ id: 'n1' }),
      row({ id: 'n2' }),
      row({ id: 'n3', userId: 'u2' }),
    ]);

    const page = await service.list(CALLER, { limit: 20, offset: 0 });

    expect(repository.listForUser).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.id)).toEqual(['n1', 'n2']);
    expect(page.items.map((i) => i.id)).not.toContain('n3');
  });

  it('exposes the paginated shape with nextCursor always null', async () => {
    const { service } = build([row({ id: 'n1' })]);

    const page = await service.list(CALLER, { limit: 20, offset: 0 });

    expect(page.nextCursor).toBeNull();
    expect(page.limit).toBe(20);
    expect(page.offset).toBe(0);
    expect(page.total).toBe(1);
  });

  it('exposes exactly the contract fields on each item', async () => {
    const { service } = build([
      row({
        id: 'n1',
        bondId: null,
        refEntityId: null,
        createdAt: new Date('2026-10-02T00:00:00Z'),
      }),
    ]);

    const page = await service.list(CALLER, { limit: 20, offset: 0 });
    const item = page.items[0];

    expect(Object.keys(item).sort()).toEqual(
      [
        'id',
        'type',
        'title',
        'body',
        'refEntityType',
        'refEntityId',
        'bondId',
        'isRead',
        'createdAt',
      ].sort(),
    );
    expect(item.bondId).toBeNull();
    expect(item.refEntityId).toBeNull();
    expect(item.createdAt).toBe('2026-10-02T00:00:00.000Z');
    expect(item.isRead).toBe(false);
  });

  it('passes the unreadOnly and bondId filters down to the repository', async () => {
    const { service, repository } = build([row({ id: 'n1' })]);

    await service.list(CALLER, { limit: 10, offset: 5, unreadOnly: true, bondId: 'b1' });

    expect(repository.listForUser).toHaveBeenCalledWith('u1', {
      limit: 10,
      offset: 5,
      unreadOnly: true,
      bondId: 'b1',
    });
  });

  it('includes bond-less notifications without a bondId filter and excludes them with one', async () => {
    const { service } = build([
      row({ id: 'with-bond', bondId: 'b1' }),
      row({ id: 'without-bond', bondId: null }),
    ]);

    const all = await service.list(CALLER, { limit: 20, offset: 0 });
    expect(all.items.map((i) => i.id)).toEqual(['with-bond', 'without-bond']);
    expect(all.total).toBe(2);

    const scoped = await service.list(CALLER, { limit: 20, offset: 0, bondId: 'b1' });
    expect(scoped.items.map((i) => i.id)).toEqual(['with-bond']);
    expect(scoped.total).toBe(1);
  });

  it('counts the caller unread notifications only (2 of 5)', async () => {
    const { service, repository } = build([
      row({ id: 'n1', isRead: false }),
      row({ id: 'n2', isRead: false }),
      row({ id: 'n3', isRead: true }),
      row({ id: 'n4', isRead: true }),
      row({ id: 'n5', isRead: true }),
      row({ id: 'foreign', userId: 'u2', isRead: false }),
    ]);

    const result = await service.unreadCount(CALLER);

    expect(repository.countUnread).toHaveBeenCalledWith('u1', undefined);
    expect(result.unreadCount).toBe(2);
  });

  it('scopes the unread count by bondId when given', async () => {
    const { service, repository } = build([
      row({ id: 'n1', bondId: 'b1', isRead: false }),
      row({ id: 'n2', bondId: 'b2', isRead: false }),
    ]);

    const result = await service.unreadCount(CALLER, 'b1');

    expect(repository.countUnread).toHaveBeenCalledWith('u1', 'b1');
    expect(result.unreadCount).toBe(1);
  });

  it('marks one notification read and drops the unread count', async () => {
    const { service } = build([row({ id: 'n1', isRead: false })]);

    const result = await service.markRead(CALLER, 'n1');

    expect(result).toEqual({ id: 'n1', isRead: true });
    expect((await service.unreadCount(CALLER)).unreadCount).toBe(0);
  });

  it('throws 404 for a missing id and for a foreign one (never 403)', async () => {
    const { service } = build([row({ id: 'foreign', userId: 'u2' })]);

    await expect(service.markRead(CALLER, 'foreign')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.markRead(CALLER, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marks all the caller unread notifications read and returns the count', async () => {
    const { service } = build([
      row({ id: 'n1', bondId: 'b1', isRead: false }),
      row({ id: 'n2', bondId: 'b2', isRead: false }),
      row({ id: 'n3', bondId: 'b1', isRead: false }),
      row({ id: 'foreign', userId: 'u2', isRead: false }),
    ]);

    const result = await service.markAllRead(CALLER);

    expect(result).toEqual({ affected: 3 });
    expect((await service.unreadCount(CALLER)).unreadCount).toBe(0);
    expect((await service.unreadCount(OTHER)).unreadCount).toBe(1);
  });

  it('marks only the bond-scoped unread notifications when bondId is given', async () => {
    const { service } = build([
      row({ id: 'n1', bondId: 'b1', isRead: false }),
      row({ id: 'n2', bondId: 'b2', isRead: false }),
    ]);

    const result = await service.markAllRead(CALLER, 'b1');

    expect(result).toEqual({ affected: 1 });
    expect((await service.unreadCount(CALLER)).unreadCount).toBe(1);
  });
});

describe('ListNotificationsQueryDto — 400 through the global ValidationPipe', () => {
  // Misma configuración que `src/app.module.ts` (whitelist + forbidNonWhitelisted + transform).
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });
  const metadata = { type: 'query' as const, metatype: ListNotificationsQueryDto };

  it('rejects out-of-range pagination with 400', async () => {
    await expect(pipe.transform({ limit: '0' }, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform({ limit: '101' }, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform({ offset: '-1' }, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform({ limit: 'abc' }, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects any unreadOnly that is not the literal true/false with 400 (never 500)', async () => {
    await expect(pipe.transform({ unreadOnly: 'maybe' }, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform({ unreadOnly: '1' }, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform({ unreadOnly: '' }, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts the literal true/false in any case', async () => {
    const yes = await pipe.transform({ unreadOnly: 'TRUE' }, metadata);
    expect(yes.unreadOnly).toBe(true);

    const no = await pipe.transform({ unreadOnly: 'False' }, metadata);
    expect(no.unreadOnly).toBe(false);
  });

  it('defaults limit to 20 and offset to 0', async () => {
    const query = await pipe.transform({}, metadata);

    expect(query.limit).toBe(20);
    expect(query.offset).toBe(0);
    expect(query.unreadOnly).toBeUndefined();
  });
});

/**
 * W1 fix — `GET /api/notifications/unread-count` se ata como DTO.
 *
 * Antes se ataba como PRIMITIVO (`@Query('bondId', new ParseUUIDPipe(…))`): los
 * primitivos de primer nivel no pasan por `whitelist`/`forbidNonWhitelisted`, así
 * que un `bondId` mal escrito se ignoraba en silencio y la ruta respondía 200 con
 * el conteo GLOBAL. Ahora la ruta rechaza los query params desconocidos con 400.
 */
describe('UnreadCountQueryDto — 400 through the global ValidationPipe', () => {
  // Misma configuración que `src/app.module.ts` (whitelist + forbidNonWhitelisted + transform).
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });
  const metadata = { type: 'query' as const, metatype: UnreadCountQueryDto };

  it('rejects an unknown/misspelled query param with 400 (no silent global count)', async () => {
    await expect(
      pipe.transform({ bondid: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ foo: '1' }, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform({ userId: 'otro-usuario' }, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a malformed bondId with 400', async () => {
    await expect(pipe.transform({ bondId: 'no-es-un-uuid' }, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts a valid UUID bondId', async () => {
    const query = await pipe.transform(
      { bondId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' },
      metadata,
    );

    expect(query.bondId).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  });

  it('accepts an absent bondId (conteo global)', async () => {
    const query = await pipe.transform({}, metadata);

    expect(query.bondId).toBeUndefined();
  });
});
