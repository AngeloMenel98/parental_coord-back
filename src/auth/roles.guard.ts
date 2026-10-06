import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '../users/entities/user.entity';
import { ROLES_KEY } from './roles.decorator';

/**
 * Guard that enforces role-based access control.
 *
 * Reads the `@Roles()` decorator metadata and compares against
 * the `systemRole` claim embedded in the JWT by `JwtStrategy`.
 *
 * Must be used AFTER `JwtAuthGuard` in the guard chain.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<SystemRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() decorator → allow everyone
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.systemRole) {
      throw new ForbiddenException('No role information in token');
    }

    const hasRole = requiredRoles.includes(user.systemRole);

    if (!hasRole) {
      throw new ForbiddenException(
        `Role "${user.systemRole}" is not authorized. Required: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
