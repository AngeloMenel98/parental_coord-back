import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
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
 * T2 · el comportamiento del grant.
 *
 * Lo que se prueba acá es la tenencia y el ciclo de vida, no la DB: los repositorios y el
 * reloj son dobles (patrón de `expenses.service.spec.ts`), y la transacción se ejecuta
 * de verdad sobre un manager falso para que el camino "grant + membresía + audit" sea el
 * mismo que en producción.
 */
describe('ThirdPartiesService', () => {
  const BOND_ID = '11111111-1111-1111-1111-111111111111';
  const OWNER_ID = '22222222-2222-2222-2222-222222222222';
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

  const grantRowRepo = { findOneByOrFail: jest.fn(), save: jest.fn() };
  const memberRowRepo = { create: jest.fn((data) => data), save: jest.fn(async (data) => data) };
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
      startDate: '2026-11-01',
      endDate: '2026-12-12',
      relationship: ThirdPartyRelationship.FAMILY,
      status: AuthThirdStatus.ACTIVE,
      scopeNote: null,
      revokedAt: null,
      revokedBy: null,
      revokedReason: null,
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      ...overrides,
    }) as AuthThirdPartyEntity;

  beforeEach(async () => {
    jest.clearAllMocks();
    grants.transaction.mockImplementation(async (fn: (m: unknown) => Promise<unknown>) => fn(manager));
    grantRowRepo.save.mockImplementation(async (row) => row);
    members.findMemberNames.mockResolvedValue(
      new Map([
        [TARGET_ID, 'Abuela Ana'],
        [OWNER_ID, 'Ángelo'],
      ]),
    );
    bonds.isActiveBondForMember.mockResolvedValue(true);
    members.findOneByBondAndUser.mockResolvedValue(progenitorMember);

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

  describe('listForOwner', () => {
    it('rechaza a un coordinador: sólo los progenitores otorgan acceso (S3/S7)', async () => {
      members.findOneByBondAndUser.mockResolvedValue({
        ...progenitorMember,
        role: BondMemberRole.COORDINATOR,
      });

      await expect(service.listForOwner(BOND_ID, OWNER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(grants.findForOwner).not.toHaveBeenCalled();
    });

    it('devuelve los grants del dueño con los nombres del vínculo', async () => {
      grants.findForOwner.mockResolvedValue([grant()]);

      const [dto] = await service.listForOwner(BOND_ID, OWNER_ID);

      expect(grants.findForOwner).toHaveBeenCalledWith(BOND_ID, OWNER_ID);
      expect(dto.displayName).toBe('Abuela Ana');
      expect(dto.authorizedByName).toBe('Ángelo');
      expect(dto.endDate).toBe('2026-12-12');
    });
  });

  describe('createForOwner', () => {
    const dto = {
      email: 'abuela@example.com',
      relationship: ThirdPartyRelationship.FAMILY,
      accessEnd: '2026-12-12',
    };

    it('responde 422 cuando el email todavía no tiene cuenta (D4)', async () => {
      users.findOneByEmail.mockResolvedValue(null);

      await expect(service.createForOwner(BOND_ID, OWNER_ID, dto)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(grants.transaction).not.toHaveBeenCalled();
    });

    it('no degrada a un progenitor del vínculo a tercero', async () => {
      users.findOneByEmail.mockResolvedValue({ id: TARGET_ID });
      // El mock base devuelve progenitor para CUALQUIER userId, así que el target
      // también aparece como progenitor del vínculo: ese es el caso que se prueba.

      await expect(service.createForOwner(BOND_ID, OWNER_ID, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rechaza un segundo grant vigente para el mismo par', async () => {
      users.findOneByEmail.mockResolvedValue({ id: TARGET_ID });
      members.findOneByBondAndUser.mockImplementation(async (_bondId: string, userId: string) =>
        userId === TARGET_ID ? null : progenitorMember,
      );
      grants.findActiveForPair.mockResolvedValue(grant());

      await expect(service.createForOwner(BOND_ID, OWNER_ID, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('escribe la membresía, el grant y el audit en una sola transacción', async () => {
      users.findOneByEmail.mockResolvedValue({ id: TARGET_ID });
      members.findOneByBondAndUser.mockImplementation(async (_bondId: string, userId: string) =>
        userId === TARGET_ID ? null : progenitorMember,
      );
      grants.findActiveForPair.mockResolvedValue(null);
      grants.saveWith.mockImplementation(async (data) => grant({ ...data } as never));

      const created = await service.createForOwner(BOND_ID, OWNER_ID, dto);

      expect(grants.transaction).toHaveBeenCalledTimes(1);
      expect(memberRowRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ bondId: BOND_ID, userId: TARGET_ID, role: BondMemberRole.THIRD_PARTY }),
      );
      expect(grants.saveWith).toHaveBeenCalledWith(
        expect.objectContaining({
          bondId: BOND_ID,
          userId: TARGET_ID,
          authorizedBy: OWNER_ID,
          startDate: TODAY,
          endDate: '2026-12-12',
          status: AuthThirdStatus.ACTIVE,
        }),
        manager,
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'third_party_grant', userId: OWNER_ID }),
        manager,
      );
      expect(created.status).toBe(AuthThirdStatus.ACTIVE);
    });

    it('rechaza un vencimiento en el pasado (D3)', async () => {
      await expect(
        service.createForOwner(BOND_ID, OWNER_ID, { ...dto, accessEnd: '2026-11-04' }),
      ).rejects.toThrow('accessEnd cannot be in the past');
    });
  });

  describe('updateForOwner', () => {
    it('no revela un grant ajeno: 404, no 403', async () => {
      grants.findById.mockResolvedValue(grant({ authorizedBy: 'otro-progenitor' }));

      await expect(
        service.updateForOwner(GRANT_ID, OWNER_ID, { accessEnd: '2026-12-20' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('no permite editar un grant revocado', async () => {
      grants.findById.mockResolvedValue(grant({ status: AuthThirdStatus.REVOKED }));

      await expect(
        service.updateForOwner(GRANT_ID, OWNER_ID, { accessEnd: '2026-12-20' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza un vencimiento anterior al inicio', async () => {
      grants.findById.mockResolvedValue(grant({ startDate: '2026-11-10' }));

      await expect(
        service.updateForOwner(GRANT_ID, OWNER_ID, { accessEnd: '2026-11-09' }),
      ).rejects.toThrow('accessEnd cannot be earlier than startDate');
    });

    it('guarda la nueva fecha y deja el par anterior/nuevo en el audit', async () => {
      const row = grant();
      grants.findById.mockResolvedValue(row);
      grantRowRepo.findOneByOrFail.mockResolvedValue({ ...row });

      const updated = await service.updateForOwner(GRANT_ID, OWNER_ID, { accessEnd: '2027-01-15' });

      expect(updated.endDate).toBe('2027-01-15');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'third_party_update',
          oldValue: expect.objectContaining({ endDate: '2026-12-12' }),
          newValue: expect.objectContaining({ endDate: '2027-01-15' }),
        }),
        manager,
      );
    });
  });

  describe('revokeForOwner', () => {
    it('marca el grant como revocado y lo audita', async () => {
      grants.findById.mockResolvedValue(grant());
      grantRowRepo.findOneByOrFail.mockResolvedValue(grant());

      const revoked = await service.revokeForOwner(GRANT_ID, OWNER_ID);

      expect(revoked.status).toBe(AuthThirdStatus.REVOKED);
      expect(revoked.revokedAt).toBe('2026-11-05T12:00:00.000Z');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'third_party_revoke' }),
        manager,
      );
    });

    it('es idempotente: revocar dos veces no duplica el audit', async () => {
      grants.findById.mockResolvedValue(grant({ status: AuthThirdStatus.REVOKED }));

      const revoked = await service.revokeForOwner(GRANT_ID, OWNER_ID);

      expect(revoked.status).toBe(AuthThirdStatus.REVOKED);
      expect(audit.record).not.toHaveBeenCalled();
      expect(grants.transaction).not.toHaveBeenCalled();
    });
  });

  describe('getMyGrant', () => {
    it('responde 404 si no hay grant', async () => {
      grants.findLatestForUser.mockResolvedValue(null);

      await expect(service.getMyGrant(TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('responde 403 cuando el grant fue revocado (T10)', async () => {
      grants.findLatestForUser.mockResolvedValue(grant({ status: AuthThirdStatus.REVOKED }));

      await expect(service.getMyGrant(TARGET_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('vence de forma perezosa: marca expired y audita una sola vez', async () => {
      grants.findLatestForUser.mockResolvedValue(grant({ endDate: '2026-11-01' }));
      grantRowRepo.findOneByOrFail.mockResolvedValue(grant({ endDate: '2026-11-01' }));

      const dto = await service.getMyGrant(TARGET_ID);

      expect(dto.status).toBe(AuthThirdStatus.EXPIRED);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'third_party_expire', userId: TARGET_ID }),
        manager,
      );
    });

    it('no toca un grant que todavía está vigente', async () => {
      grants.findLatestForUser.mockResolvedValue(grant());

      const dto = await service.getMyGrant(TARGET_ID);

      expect(dto.status).toBe(AuthThirdStatus.ACTIVE);
      expect(grants.transaction).not.toHaveBeenCalled();
      expect(dto.authorizedByName).toBe('Ángelo');
    });
  });
});
