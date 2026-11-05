import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

const user = { id: 'u1' } as never;

function build() {
  const subscriptions = {
    create: jest.fn().mockResolvedValue({ id: 's1' }),
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({ id: 's1' }),
    update: jest.fn().mockResolvedValue({ id: 's1' }),
    remove: jest.fn().mockResolvedValue(undefined),
    rotateSecret: jest.fn().mockResolvedValue({ secret: 'x' }),
    test: jest.fn().mockResolvedValue({ queued: true }),
  };
  return {
    controller: new SubscriptionsController(subscriptions as unknown as SubscriptionsService),
    subscriptions,
  };
}

describe('SubscriptionsController (T-W1.29, REQ-SUB-1..6)', () => {
  it('is mounted under bonds/:bondId/webhooks behind JwtAuthGuard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SubscriptionsController)).toBe(
      'bonds/:bondId/webhooks',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, SubscriptionsController)).toEqual([JwtAuthGuard]);
  });

  it('delegates each route to SubscriptionsService with the authenticated user', async () => {
    const ctx = build();

    await ctx.controller.create('b1', { url: 'https://x.example' }, user);
    await ctx.controller.list('b1', user);
    await ctx.controller.get('b1', 's1', user);
    await ctx.controller.update('b1', 's1', { description: 'd' }, user);
    await ctx.controller.remove('b1', 's1', user);
    await ctx.controller.rotateSecret('b1', 's1', user);
    await ctx.controller.test('b1', 's1', user);

    expect(ctx.subscriptions.create).toHaveBeenCalledWith('b1', { url: 'https://x.example' }, user);
    expect(ctx.subscriptions.rotateSecret).toHaveBeenCalledWith('b1', 's1', user);
    expect(ctx.subscriptions.test).toHaveBeenCalledWith('b1', 's1', user);
    expect(ctx.subscriptions.remove).toHaveBeenCalledWith('b1', 's1', user);
  });

  it('returns 204 on delete and 202 on test-ping', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, SubscriptionsController.prototype.remove)).toBe(
      HttpStatus.NO_CONTENT,
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, SubscriptionsController.prototype.test)).toBe(
      HttpStatus.ACCEPTED,
    );
  });

  it('exposes the event catalog', () => {
    const ctx = build();
    const catalog = ctx.controller.eventTypes();
    expect(Array.isArray(catalog)).toBe(true);
  });
});
