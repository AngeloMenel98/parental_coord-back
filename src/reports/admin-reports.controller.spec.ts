import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SystemRole } from '../users/entities/user.entity';

import { AdminReportsController } from './admin-reports.controller';

/** B2 · S5 — el reporte vive bajo la misma guarda de admin que el resto. */
describe('AdminReportsController guards (B2)', () => {
  it('keeps the admin role and both guards on the controller', () => {
    const guards = Reflect.getMetadata('__guards__', AdminReportsController);
    const roles = Reflect.getMetadata(ROLES_KEY, AdminReportsController);

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(roles).toEqual([SystemRole.ADMIN]);
  });
});
