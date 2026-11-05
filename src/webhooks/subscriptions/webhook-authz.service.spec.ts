import { ForbiddenException } from '@nestjs/common';

import { AuthUser } from '../../auth/dto/auth-user.dto';
import { BondsService } from '../../bonds/bonds.service';
import { SystemRole } from '../../users/entities/user.entity';
import { WebhookAuthzService } from './webhook-authz.service';

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    email: 'u1@example.com',
    systemRole: SystemRole.USER,
    ...overrides,
  } as AuthUser;
}

describe('WebhookAuthzService (T-W1.26, REQ-SUB-1, Q1)', () => {
  let bonds: { isActiveBondForMember: jest.Mock };
  let authz: WebhookAuthzService;

  beforeEach(() => {
    bonds = { isActiveBondForMember: jest.fn() };
    authz = new WebhookAuthzService(bonds as unknown as BondsService);
  });

  it('allows an active bond member to manage', async () => {
    bonds.isActiveBondForMember.mockResolvedValue(true);
    await expect(authz.assertCanManage('b1', user())).resolves.toBeUndefined();
    expect(bonds.isActiveBondForMember).toHaveBeenCalledWith('b1', 'u1');
  });

  it('allows a global admin to manage without a membership check', async () => {
    await expect(
      authz.assertCanManage('b1', user({ systemRole: SystemRole.ADMIN })),
    ).resolves.toBeUndefined();
    expect(bonds.isActiveBondForMember).not.toHaveBeenCalled();
  });

  it('rejects a non-member with 403', async () => {
    bonds.isActiveBondForMember.mockResolvedValue(false);
    await expect(authz.assertCanManage('b1', user())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an active member to read and rejects a non-member', async () => {
    bonds.isActiveBondForMember.mockResolvedValueOnce(true);
    await expect(authz.assertCanRead('b1', user())).resolves.toBeUndefined();

    bonds.isActiveBondForMember.mockResolvedValueOnce(false);
    await expect(authz.assertCanRead('b1', user())).rejects.toBeInstanceOf(ForbiddenException);
  });
});
