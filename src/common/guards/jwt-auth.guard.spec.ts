import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import {
  ALLOW_DURING_PASSWORD_CHANGE,
  AllowDuringPasswordChange,
} from '../decorators/allow-during-password-change.decorator';
import { AuthController } from '../../auth/auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * S2 · el candado del cambio obligatorio.
 *
 * Pasaporte ya autenticó cuando corre este guard, así que lo que se prueba acá es la
 * segunda mitad: con `mustChangePassword === true` en el token, TODA ruta autenticada
 * responde 403 `PASSWORD_CHANGE_REQUIRED` salvo las marcadas con el decorador —las dos
 * que necesita el cliente para salir del estado: `change-password` y `me`.
 *
 * El guard hereda de `AuthGuard('jwt')`; el prototipo del mixin se mockea para no montar
 * passport entero. Las rutas son una clase real con los decoradores reales, así que el
 * `Reflector` lee la metadata de verdad.
 */
class Routes {
  @AllowDuringPasswordChange()
  changePassword(): void {}

  @AllowDuringPasswordChange()
  me(): void {}

  normal(): void {}
}

const contextFor = (handler: () => void, user: unknown): ExecutionContext => {
  const request = { user };
  return {
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('JwtAuthGuard · cambio obligatorio de contraseña (S2)', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn((AuthGuard('jwt') as any).prototype, 'canActivate').mockResolvedValue(true);
    guard = new JwtAuthGuard(new Reflector());
  });

  const blockedBody = async (context: ExecutionContext): Promise<Record<string, any>> => {
    const error = await guard.canActivate(context).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getStatus()).toBe(403);
    return (error as ForbiddenException).getResponse() as Record<string, any>;
  };

  it('bloquea una ruta autenticada normal con 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const body = await blockedBody(
      contextFor(Routes.prototype.normal, { id: 'u1', mustChangePassword: true }),
    );

    expect(body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(body.statusCode).toBe(403);
  });

  it('deja pasar POST /auth/change-password', async () => {
    await expect(
      guard.canActivate(
        contextFor(Routes.prototype.changePassword, { id: 'u1', mustChangePassword: true }),
      ),
    ).resolves.toBe(true);
  });

  it('deja pasar GET /auth/me (el cliente necesita saber quién es)', async () => {
    await expect(
      guard.canActivate(contextFor(Routes.prototype.me, { id: 'u1', mustChangePassword: true })),
    ).resolves.toBe(true);
  });

  it('un token sin la claim vale como false y no bloquea (backward compatible)', async () => {
    await expect(
      guard.canActivate(contextFor(Routes.prototype.normal, { id: 'u1' })),
    ).resolves.toBe(true);
  });

  it('mustChangePassword === false no bloquea', async () => {
    await expect(
      guard.canActivate(
        contextFor(Routes.prototype.normal, { id: 'u1', mustChangePassword: false }),
      ),
    ).resolves.toBe(true);
  });

  it('en AuthController sólo change-password y me están exentas', () => {
    const reflector = new Reflector();
    const exempt = ['me', 'changePassword', 'login', 'register'].filter(
      (method) =>
        reflector.getAllAndOverride<boolean>(ALLOW_DURING_PASSWORD_CHANGE, [
          (AuthController.prototype as any)[method],
          AuthController,
        ]) === true,
    );

    expect(exempt).toEqual(['me', 'changePassword']);
  });

  it('no convierte un request sin autenticar en 403', async () => {
    jest
      .spyOn((AuthGuard('jwt') as any).prototype, 'canActivate')
      .mockResolvedValue(false);

    await expect(
      guard.canActivate(contextFor(Routes.prototype.normal, undefined)),
    ).resolves.toBe(false);
  });
});
