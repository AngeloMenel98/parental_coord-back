import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WebhookDeliveryController } from './delivery.controller';
import { WebhookDeliveryLogController } from './delivery-log.controller';
import { SubscriptionsController } from '../subscriptions/subscriptions.controller';

const THROTTLER_LIMIT_DEFAULT = 'THROTTLER:LIMITdefault';
const THROTTLER_TTL_DEFAULT = 'THROTTLER:TTLdefault';
const API_TAGS = 'swagger/apiUseTags';
const API_SECURITY = 'swagger/apiSecurity';

type Ctor = { prototype: Record<string, unknown>; name: string };

const CONTROLLERS: Ctor[] = [
  SubscriptionsController as unknown as Ctor,
  WebhookDeliveryLogController as unknown as Ctor,
  WebhookDeliveryController as unknown as Ctor,
];

function routeHandlers(controller: Ctor): string[] {
  return Object.getOwnPropertyNames(controller.prototype).filter(
    (name) => name !== 'constructor' && typeof controller.prototype[name] === 'function',
  );
}

/**
 * T-W2.6 — Endurecimiento del API de webhooks (REQ-SEC-5, AC-20).
 *
 * Garantiza que TODO handler de los controladores de webhooks lleva su propio
 * `@Throttle` por ruta (además del de clase) y que la clase está documentada con
 * `@ApiTags('webhooks')` + `@ApiBearerAuth()` y protegida por `JwtAuthGuard`.
 * Así una ruta nueva no puede colarse sin límite ni sin auth.
 */
describe('Webhook API hardening (T-W2.6, REQ-SEC-5)', () => {
  it.each(CONTROLLERS)('$name: every handler carries per-route throttle metadata', (controller) => {
    const handlers = routeHandlers(controller);
    expect(handlers.length).toBeGreaterThan(0);

    for (const name of handlers) {
      const fn = controller.prototype[name] as object;
      const limit = Reflect.getMetadata(THROTTLER_LIMIT_DEFAULT, fn) as number | undefined;
      const ttl = Reflect.getMetadata(THROTTLER_TTL_DEFAULT, fn) as number | undefined;

      expect({ handler: name, limit }).toEqual({ handler: name, limit: expect.any(Number) });
      expect(limit).toBeGreaterThan(0);
      expect(ttl).toBeGreaterThan(0);
    }
  });

  it.each(CONTROLLERS)('$name: is throttled at the class level too', (controller) => {
    expect(Reflect.getMetadata(THROTTLER_LIMIT_DEFAULT, controller)).toEqual(expect.any(Number));
  });

  it.each(CONTROLLERS)('$name: is documented as a bearer-auth webhooks tag', (controller) => {
    expect(Reflect.getMetadata(API_TAGS, controller)).toContain('webhooks');
    expect(Reflect.getMetadata(API_SECURITY, controller)).toBeDefined();
  });

  it.each(CONTROLLERS)('$name: is guarded by JwtAuthGuard', (controller) => {
    const guards = Reflect.getMetadata('__guards__', controller) as unknown[] | undefined;
    expect(guards).toContain(JwtAuthGuard);
  });
});
