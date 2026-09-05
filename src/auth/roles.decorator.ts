import { SetMetadata } from '@nestjs/common';
import { SystemRole } from '../users/entities/user.entity';

export const ROLES_KEY = 'roles';

/**
 * Decorator to restrict access to specific system roles.
 *
 * @example
 *   @Roles(SystemRole.ADMIN)
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   async adminOnlyEndpoint() { ... }
 */
export const Roles = (...roles: SystemRole[]) => SetMetadata(ROLES_KEY, roles);
