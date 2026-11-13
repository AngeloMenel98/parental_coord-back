import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { BondsService } from '../bonds/bonds.service';
import { BondMemberEntity, BondMemberRole } from '../bonds/entities/bond-member.entity';
import { BondMembersRepository } from '../bonds/repositories/bond-members.repository';
import { Clock } from '../common/clock/clock';
import {
  AuthThirdPartyEntity,
  AuthThirdStatus,
  ThirdPartyRelationship,
} from '../expenses/entities/auth-third-party.entity';
import { UsersRepository } from '../users/repositories/users.repository';
import { AuthThirdPartiesRepository } from './repositories/auth-third-parties.repository';
import { ThirdPartiesAuditRepository } from './repositories/third-parties-audit.repository';
import { ThirdPartiesService } from './third-parties.service';

/**
 * Regresiones del ciclo de vida del grant, derivadas de la verificación independiente
 * del módulo (F1, F2, F3 y los caminos que no cubría la primera tanda de pruebas).
 *
 * Los casos que fallaban antes de la corrección quedan como prueba permanente: un grant
 * vencido sin barrer bloqueaba volver a otorgar (F1), el 409 distinguía un grant ajeno
 * (F2) y `update`/`revoke` no revalidaban que el dueño siguiera siendo progenitor activo
 * (F3).
 */
describe('ThirdPartiesService · regresiones del ciclo de vida', () => {
  const BOND_ID = '11111111-1111-1111-1111-111111111111';
  const OWNER_ID = '22222222-2222-2222-2222-222222222222';
  const OTHER_PROGENITOR_ID = '55555555-5555-5555-5555-555555555555';
  const TARGET_ID = '33333333-3333-3333-3333-333333333333';
  const GRANT_ID = '44444444-4444-4444-4444-444444444444';
  const TODAY = '2026-11-05';

  const grants = {
    findForOwner: jest.fn(),
    findActiveForPair: jest.fn(),
    findLatestForUser: jest.fn(),
    findById: jest.fn(),
    saveWith: jest.fn(),
    transaction: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const bonds = { isActiveBondForMember: jest.fn() };
  const members = { findOneByBondAndUser: jest.fn(), findMemberNames: jest.fn() };
  const users = { findOneByEmail: jest.fn() };
  const clock = { now: jest.fn(() => new Date(`${TODAY}T12:00:00.000Z`)) };
  const clockNow = clock.now;

  const grantRowRepo = {
    findOneByOrFail: jest.fn(),
    find: jest.fn(async (): Promise<AuthThirdPartyEntity[]> => []),
    save: jest.fn(async (row) => row),
  };
  const memberRowRepo = { create: jest.fn((data) => data), save: jest.fn(async (d) => d) };
  const manager = {
    getRepository: jest.fn((entity) =>
      entity === BondMemberEntity ? memberRowRepo : grantRowRepo,
    ),
  };

  let service: ThirdPartiesService;

  const progenitorMember = {
    bondId: BOND_ID,
    userId: OWNER_ID,
    role: BondMemberRole.PROGENITOR,
    leftAt: null,
  } as unknown as BondMemberEntity;

  const grant = (overrides: Partial<AuthThirdPartyEntity> = {}) =>
    ({
      id: GRANT_ID,
      bondId: BOND_ID,
      userId: TARGET_ID,
      authorizedBy: OWNER_ID,
      startDate: '2026-10-01',
      endDate: '2026-12-12',
      relationship: ThirdPartyRelationship.FAMILY,
      status: AuthThirdStatus.ACTIVE,
      scopeNote: null,
      revokedAt: null,
      revokedBy: null,
      revokedReason: null,
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
      ...overrides,
    }) as AuthThirdPartyEntity;

  const dto = {
    email: 'abuela@example.com',
    relationship: ThirdPartyRelationship.FAMILY,
    accessEnd: '2026-12-12',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    clockNow.mockReturnValue(new Date(`${TODAY}T12:00:00.000Z`));
    grants.transaction.mockImplementation(async (fn: (m: unknown) => Promise<unknown>) => fn(manager));
    grants.saveWith.mockImplementation(async (data) => grant({ ...data } as never));
    grantRowRepo.find.mockResolvedValue([]);
    grantRowRepo.save.mockImplementation(async (row) => row);
    grantRowRepo.findOneByOrFail.mockImplementation(async () => grant());
    members.findMemberNames.mockResolvedValue(
      new Map([
        [TARGET_ID, 'Abuela Ana'],
        [OWNER_ID, 'Ángelo'],
      ]),
    );
    bonds.isActiveBondForMember.mockResolvedValue(true);
    members.findOneByBondAndUser.mockImplementation(async (_bondId: string, userId: string) =>
      userId === TARGET_ID ? null : progenitorMember,
    );
    users.findOneByEmail.mockResolvedValue({ id: TARGET_ID });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ThirdPartiesService,
        { provide: AuthThirdPartiesRepository, useValue: grants },
        { provide: ThirdPartiesAuditRepository, useValue: audit },
        { provide: BondsService, useValue: bonds },
        { provide: BondMembersRepository, useValue: members },
        { provide: UsersRepository, useValue: users },
        { provide: Clock, useValue: clock },
      ],
    }).compile();

    service = moduleRef.get(ThirdPartiesService);
  });

  it('F1 · un grant vencido por fecha se barre y no bloquea volver a otorgar', async () => {
    const lapsed = grant({ endDate: '2026-01-01' });
    grants.findActiveForPair.mockResolvedValue(lapsed);
    grantRowRepo.find.mockResolvedValue([lapsed]);

    const created = await service.createForOwner(BOND_ID, OWNER_ID, dto);

    expect(created.status).toBe(AuthThirdStatus.ACTIVE);
    expect(grantRowRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: GRANT_ID, status: AuthThirdStatus.EXPIRED }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'third_party_expire', grantId: GRANT_ID }),
      manager,
    );
  });

  it('F1 · la lista del dueño devuelve vencido lo que venció, no vigente', async () => {
    grants.findForOwner.mockResolvedValue([grant({ endDate: '2026-01-01' })]);

    const [dtoRow] = await service.listForOwner(BOND_ID, OWNER_ID);

    expect(dtoRow.status).toBe(AuthThirdStatus.EXPIRED);
  });

  it('F1 · un grant vigente de verdad sigue rechazando el alta', async () => {
    grants.findActiveForPair.mockResolvedValue(grant({ endDate: '2026-12-12' }));

    await expect(service.createForOwner(BOND_ID, OWNER_ID, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('F2 · el 409 no distingue si el grant lo otorgó el llamante u otro progenitor', async () => {
    grants.findActiveForPair.mockResolvedValue(grant({ authorizedBy: OWNER_ID }));
    const mine = await service.createForOwner(BOND_ID, OWNER_ID, dto).catch((e) => e);

    grants.findActiveForPair.mockResolvedValue(grant({ authorizedBy: OTHER_PROGENITOR_ID }));
    const foreign = await service
      .createForOwner(BOND_ID, OTHER_PROGENITOR_ID, dto)
      .catch((e) => e);

    expect(mine).toBeInstanceOf(ConflictException);
    expect(foreign).toBeInstanceOf(ConflictException);
    expect(foreign.message).toBe(mine.message);
    expect(mine.message).not.toMatch(/vigente/);
  });

  it('F3 · si el dueño dejó de ser progenitor activo no puede extender ni revocar', async () => {
    bonds.isActiveBondForMember.mockResolvedValue(false);
    members.findOneByBondAndUser.mockResolvedValue(null);
    grants.findById.mockResolvedValue(grant());

    await expect(
      service.updateForOwner(GRANT_ID, OWNER_ID, { accessEnd: '2030-01-01' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.revokeForOwner(GRANT_ID, OWNER_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('revocar un grant ajeno responde 404, no 403', async () => {
    grants.findById.mockResolvedValue(grant({ authorizedBy: OTHER_PROGENITOR_ID }));

    await expect(service.revokeForOwner(GRANT_ID, OWNER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('D3 · revocar un grant vencido es 409, no una revocación silenciosa', async () => {
    grants.findById.mockResolvedValue(grant({ status: AuthThirdStatus.EXPIRED }));

    await expect(service.revokeForOwner(GRANT_ID, OWNER_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('D3 · el vencimiento perezoso es idempotente: la segunda llamada no escribe nada', async () => {
    grants.findLatestForUser.mockResolvedValue(
      grant({ status: AuthThirdStatus.EXPIRED, endDate: '2026-11-01' }),
    );

    const dtoRow = await service.getMyGrant(TARGET_ID);

    expect(dtoRow.status).toBe(AuthThirdStatus.EXPIRED);
    expect(grants.transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('D3 · un accessEnd en el pasado se rechaza también al editar', async () => {
    grants.findById.mockResolvedValue(grant());

    await expect(
      service.updateForOwner(GRANT_ID, OWNER_ID, { accessEnd: '2026-11-04' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('relación y nota se actualizan y quedan auditadas con el par anterior/nuevo', async () => {
    const row = grant();
    grants.findById.mockResolvedValue(row);
    grantRowRepo.findOneByOrFail.mockResolvedValue({ ...row });

    const updated = await service.updateForOwner(GRANT_ID, OWNER_ID, {
      relationship: ThirdPartyRelationship.CAREGIVER,
      note: 'Va a buscar a los chicos los martes',
    });

    expect(updated.relationship).toBe(ThirdPartyRelationship.CAREGIVER);
    expect(updated.note).toBe('Va a buscar a los chicos los martes');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'third_party_update',
        oldValue: expect.objectContaining({ relationship: ThirdPartyRelationship.FAMILY }),
        newValue: expect.objectContaining({ relationship: ThirdPartyRelationship.CAREGIVER }),
      }),
      manager,
    );
  });
});
