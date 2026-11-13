import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { BondAccessCache, BondAccessService } from './bond-access.service';
import { BondMemberRole } from './entities/bond-member.entity';
import { BondAccessRow, BondMembersRepository } from './repositories/bond-members.repository';
import { Clock } from '../common/clock/clock';

/**
 * T3 · el chokepoint de acceso.
 *
 * Lo que se prueba es exactamente lo que el chequeo repartido de antes no hacía: que un
 * tercero temporal sin grant vivo **no** tenga acceso, y que asignarle algo sea sólo del
 * progenitor que lo autorizó (S7). Con el reloj y el repositorio sustituidos: la regla
 * es del servicio, no de la DB.
 */
describe('BondAccessService', () => {
  const BOND_ID = '11111111-1111-1111-1111-111111111111';
  const USER_ID = '22222222-2222-2222-2222-222222222222';
  const OWNER_ID = '33333333-3333-3333-3333-333333333333';
  const TODAY = '2026-11-05';

  const members = { findAccessRow: jest.fn() };
  const clock = { now: jest.fn(() => new Date(`${TODAY}T12:00:00.000Z`)) };

  let service: BondAccessService;

  const row = (overrides: Partial<BondAccessRow> = {}): BondAccessRow => ({
    userId: USER_ID,
    role: BondMemberRole.PROGENITOR,
    leftAt: null,
    grantId: null,
    grantStatus: null,
    grantStart: null,
    grantEnd: null,
    grantedBy: null,
    ...overrides,
  });

  const thirdPartyRow = (overrides: Partial<BondAccessRow> = {}): BondAccessRow =>
    row({
      role: BondMemberRole.THIRD_PARTY,
      grantId: '44444444-4444-4444-4444-444444444444',
      grantStatus: 'active',
      grantStart: '2026-10-01',
      grantEnd: '2026-12-12',
      grantedBy: OWNER_ID,
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    clock.now.mockReturnValue(new Date(`${TODAY}T12:00:00.000Z`));
    service = new BondAccessService(
      members as unknown as BondMembersRepository,
      clock as unknown as Clock,
    );
  });

  it('un progenitor activo tiene acceso sin grant', async () => {
    members.findAccessRow.mockResolvedValue(row());

    const access = await service.assertBondAccess(BOND_ID, USER_ID);

    expect(access.role).toBe(BondMemberRole.PROGENITOR);
    expect(access.isThirdParty).toBe(false);
    expect(access.grant).toBeUndefined();
  });

  it('un no miembro es 404, no 403: no se confirma que el vínculo exista', async () => {
    members.findAccessRow.mockResolvedValue(null);

    await expect(service.assertBondAccess(BOND_ID, USER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('un miembro que dejó el vínculo no tiene acceso', async () => {
    members.findAccessRow.mockResolvedValue(row({ leftAt: '2026-10-01T00:00:00.000Z' }));

    expect(await service.resolveBondAccess(BOND_ID, USER_ID)).toBeNull();
  });

  it('un tercero con grant vigente tiene acceso y su grant', async () => {
    members.findAccessRow.mockResolvedValue(thirdPartyRow());

    const access = await service.assertBondAccess(BOND_ID, USER_ID);

    expect(access.isThirdParty).toBe(true);
    expect(access.grant).toEqual(
      expect.objectContaining({ authorizedBy: OWNER_ID, endDate: '2026-12-12' }),
    );
  });

  it('un tercero con grant vencido por fecha no tiene acceso, aunque siga `active`', async () => {
    members.findAccessRow.mockResolvedValue(thirdPartyRow({ grantEnd: '2026-11-01' }));

    await expect(service.assertBondAccess(BOND_ID, USER_ID)).rejects.toThrow(
      'Tu acceso temporal terminó',
    );
  });

  it('un tercero sin grant vivo (revocado o inexistente) no tiene acceso', async () => {
    members.findAccessRow.mockResolvedValue(thirdPartyRow({ grantId: null, grantStatus: null }));

    await expect(service.assertBondAccess(BOND_ID, USER_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('S7 · asignarle a un tercero exige ser el progenitor que lo autorizó', async () => {
    members.findAccessRow.mockResolvedValue(thirdPartyRow());

    await expect(
      service.assertCanAssignTo(BOND_ID, OWNER_ID, USER_ID),
    ).resolves.toBeUndefined();
    await expect(
      service.assertCanAssignTo(BOND_ID, 'otro-progenitor', USER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('asignarle a un miembro que no es tercero no cambia de dueño por esta regla', async () => {
    members.findAccessRow.mockResolvedValue(row());

    await expect(
      service.assertCanAssignTo(BOND_ID, 'cualquier-miembro', USER_ID),
    ).resolves.toBeUndefined();
  });

  it('el memo del request hace una sola consulta', async () => {
    members.findAccessRow.mockResolvedValue(row());
    const cache = new BondAccessCache();

    await service.assertBondAccess(BOND_ID, USER_ID, cache);
    await service.assertBondAccess(BOND_ID, USER_ID, cache);
    await service.assertCanAssignTo(BOND_ID, USER_ID, USER_ID, cache);

    expect(members.findAccessRow).toHaveBeenCalledTimes(1);
  });
});
