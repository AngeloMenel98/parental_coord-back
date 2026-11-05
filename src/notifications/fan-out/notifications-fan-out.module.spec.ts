import 'reflect-metadata';

import { NotificationsFanOutModule } from './notifications-fan-out.module';

describe('NotificationsFanOutModule', () => {
  it('is defined', () => {
    expect(NotificationsFanOutModule).toBeDefined();
  });

  it('does not import NotificationsModule', () => {
    const imports: any[] = (Reflect.getMetadata('imports', NotificationsFanOutModule) ||
      []) as any[];
    const importedNames = imports.map((imp: any) => imp?.name || String(imp));
    expect(importedNames).not.toContain('NotificationsModule');
  });

  it('imports ActivitiesModule and BondsModule', () => {
    const imports: any[] = (Reflect.getMetadata('imports', NotificationsFanOutModule) ||
      []) as any[];
    const importedNames = imports.map((imp: any) => imp?.name || String(imp));
    expect(importedNames).toContain('ActivitiesModule');
    expect(importedNames).toContain('BondsModule');
  });

  it('provides NotificationFanOutService and NotificationRepository', () => {
    const providers: any[] = (Reflect.getMetadata('providers', NotificationsFanOutModule) ||
      []) as any[];
    const providerNames = providers.map((p: any) =>
      typeof p === 'function' ? p.name : p?.provide?.name || p?.provide,
    );
    expect(providerNames).toContain('NotificationFanOutService');
    expect(providerNames).toContain('NotificationRepository');
  });
});
