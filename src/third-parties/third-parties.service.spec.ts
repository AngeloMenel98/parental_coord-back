import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `hashed:${value}`),
  compare: jest.fn(async () => true),
}));

import * as bcrypt from 'bcryptjs';

import { BondAccessService } from '../bonds/bond-access.service';
import { BondMemberEntity, BondMemberRole } from '../bonds/entities/bond-member.entity';
import { BondMembersRepository } from '../bonds/repositories/bond-members.repository';
import { Clock } from '../common/clock/clock';
import {
  AuthThirdPartyEntity,
  AuthThirdStatus,
  ThirdPartyRelationship,
} from '../expenses/entities/auth-third-party.entity';
import { MailerService } from '../mail/mailer.service';
import { SystemRole, UserEntity } from '../users/entities/user.entity';
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
  const access = { assertBondAccess: jest.fn() };
  const members = { findOneByBondAndUser: jest.fn(), findMemberNames: jest.fn() };
  const users = { findOneByEmail: jest.fn() };
  const mailer = { isConfigured: jest.fn(() => true), sendMail: jest.fn() };
  const clock = { now: jest.fn(() => new Date(`${TODAY}T12:00:00.000Z`)) };

  const grantRowRepo = {
    findOneByOrFail: jest.fn(),
    // El alta barre los grants vencidos del par antes de insertar (F1): el manager
    // también consulta con `find`.
    find: jest.fn(async (): Promise<AuthThirdPartyEntity[]> => []),
    save: jest.fn(),
    // El vencimiento es un UPDATE condicional (R4-004), no un `save`.
    update: jest.fn(async (): Promise<{ affected: number }> => ({ affected: 1 })),
  };
  const memberRowRepo = {
    create: jest.fn((data) => data),
    save: jest.fn(async (data) => data),
    // Revocar cierra la membresía (R1-001).
    update: jest.fn(async () => ({ affected: 1 })),
  };
  // El alta con email desconocido escribe la cuenta con el manager de la transacción:
  // la cuenta y el grant se commitean (o se revierten) juntos.
  const userRowRepo = {
    create: jest.fn((data) => data),
    save: jest.fn(async (data: Record<string, unknown>) => ({ id: TARGET_ID, ...data })),
    // Compensación del alta cuando el mail no sale (R3-001/R4-001): borra el user y
    // las FK en cascada limpian membresía y grant.
    delete: jest.fn(async () => ({ affected: 1 })),
  };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === BondMemberEntity) return memberRowRepo;
      if (entity === UserEntity) return userRowRepo;
      return grantRowRepo;
    }),
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
    userRowRepo.save.mockImplementation(async (data: Record<string, unknown>) => ({
      id: TARGET_ID,
      ...data,
    }));
    memberRowRepo.save.mockImplementation(async (data) => data);
    mailer.sendMail.mockResolvedValue(undefined);
    members.findMemberNames.mockResolvedValue(
      new Map([
        [TARGET_ID, 'Abuela Ana'],
        [OWNER_ID, 'Ángelo'],
      ]),
    );
    access.assertBondAccess.mockResolvedValue({ role: BondMemberRole.PROGENITOR, isThirdParty: false });
    members.findOneByBondAndUser.mockResolvedValue(progenitorMember);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ThirdPartiesService,
        { provide: AuthThirdPartiesRepository, useValue: grants },
        { provide: ThirdPartiesAuditRepository, useValue: audit },
        { provide: BondAccessService, useValue: access },
        { provide: BondMembersRepository, useValue: members },
        { provide: UsersRepository, useValue: users },
        { provide: MailerService, useValue: mailer },
        { provide: Clock, useValue: clock },
      ],
    }).compile();

    service = moduleRef.get(ThirdPartiesService);
  });

  describe('listForOwner', () => {
    it('rechaza a un coordinador: sólo los progenitores otorgan acceso (S3/S7)', async () => {
      access.assertBondAccess.mockResolvedValue({
        role: BondMemberRole.COORDINATOR,
        isThirdParty: false,
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
      firstName: 'Abuela',
      lastName: 'Ana',
    };

    it('con email desconocido crea la cuenta y manda usuario + contraseña (S1, D2)', async () => {
      users.findOneByEmail.mockResolvedValue(null);
      grants.saveWith.mockImplementation(async (data) => grant({ ...data } as never));

      const created = await service.createForOwner(BOND_ID, OWNER_ID, dto);

      // Una sola transacción: cuenta, membresía y grant se escriben juntos.
      expect(grants.transaction).toHaveBeenCalledTimes(1);
      expect(userRowRepo.save).toHaveBeenCalledTimes(1);
      expect(userRowRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'abuela@example.com',
          systemRole: SystemRole.USER,
          isActive: true,
          // La contraseña la generó el sistema: hay que cambiarla al entrar (S2).
          mustChangePassword: true,
        }),
      );
      expect(memberRowRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: TARGET_ID, role: BondMemberRole.THIRD_PARTY }),
      );
      expect(created.userId).toBe(TARGET_ID);
      expect(created.status).toBe(AuthThirdStatus.ACTIVE);
    });

    it('la contraseña generada es de 12–16 caracteres y sin caracteres ambiguos', async () => {
      users.findOneByEmail.mockResolvedValue(null);
      grants.saveWith.mockImplementation(async (data) => grant({ ...data } as never));

      await service.createForOwner(BOND_ID, OWNER_ID, dto);

      const generated = (bcrypt.hash as jest.Mock).mock.calls[0][0] as string;
      // Sin `I`, `l`, `O`, `0` ni `1`: se confunden al tipear lo que llega por mail.
      expect(generated).toMatch(/^[A-HJ-NP-Za-km-z2-9]{12,16}$/);
      // Mismas 10 rondas que el resto del repo.
      expect(bcrypt.hash).toHaveBeenCalledWith(generated, 10);
      expect(userRowRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ passwordHash: `hashed:${generated}` }),
      );
    });

    it('el correo lleva usuario, contraseña, vencimiento y la instrucción de cambiarla', async () => {
      users.findOneByEmail.mockResolvedValue(null);
      grants.saveWith.mockImplementation(async (data) => grant({ ...data } as never));

      await service.createForOwner(BOND_ID, OWNER_ID, dto);

      expect(mailer.sendMail).toHaveBeenCalledTimes(1);
      const mail = mailer.sendMail.mock.calls[0][0];
      const generated = (bcrypt.hash as jest.Mock).mock.calls[0][0] as string;

      expect(mail.to).toBe('abuela@example.com');
      expect(mail.subject).toContain('Parental Coordination');
      expect(mail.text).toContain('Parental Coordination');
      expect(mail.text).toContain('Usuario: abuela@example.com');
      expect(mail.text).toContain(generated);
      expect(mail.text).toContain('12/12/2026');
      expect(mail.text).toContain('cambies la contraseña');
    });

    it('si el correo falla, commitea y después compensa borrando la cuenta (R3-001/R4-001)', async () => {
      users.findOneByEmail.mockResolvedValue(null);
      const events: string[] = [];
      grants.transaction.mockImplementation(async (fn: (m: unknown) => Promise<unknown>) => {
        events.push('begin');
        const result = await fn(manager);
        events.push('commit');
        return result;
      });
      userRowRepo.save.mockImplementation(async (data: Record<string, unknown>) => {
        events.push('user');
        return { id: TARGET_ID, ...data };
      });
      userRowRepo.delete.mockImplementation(async () => {
        events.push('cleanup');
        return { affected: 1 };
      });
      memberRowRepo.save.mockImplementation(async (data) => {
        events.push('member');
        return data;
      });
      grants.saveWith.mockImplementation(async (data) => {
        events.push('grant');
        return grant({ ...data } as never);
      });
      mailer.sendMail.mockImplementation(async () => {
        events.push('mail');
        throw new ServiceUnavailableException('No se pudo enviar el correo');
      });

      await expect(service.createForOwner(BOND_ID, OWNER_ID, dto)).rejects.toBeInstanceOf(
        BadGatewayException,
      );

      // El correo sale DESPUÉS del commit: nada de I/O externo con la transacción
      // abierta, y un commit fallido no entrega credenciales. Si el correo falla, se
      // compensa borrando la cuenta recién creada.
      expect(events).toEqual([
        'begin',
        'user',
        'member',
        'grant',
        'commit',
        'mail',
        // La compensación es su propia transacción.
        'begin',
        'cleanup',
        'commit',
      ]);
      expect(userRowRepo.delete).toHaveBeenCalledWith({ id: TARGET_ID });
    });

    it('si la compensación también falla, el error NO dice que no quedó nada (REG-001)', async () => {
      users.findOneByEmail.mockResolvedValue(null);
      grants.transaction.mockImplementation(async (fn: (m: unknown) => Promise<unknown>) =>
        fn(manager),
      );
      memberRowRepo.save.mockImplementation(async (data) => data);
      grants.saveWith.mockImplementation(async (data) => grant({ ...data } as never));
      mailer.sendMail.mockRejectedValue(new ServiceUnavailableException('sin SMTP'));
      // La compensación falla: la cuenta commiteada sigue existiendo.
      userRowRepo.delete.mockRejectedValue(new Error('db down'));

      const failure = service.createForOwner(BOND_ID, OWNER_ID, dto);

      await expect(failure).rejects.toBeInstanceOf(BadGatewayException);
      await expect(failure).rejects.toThrow(/quedó creada/);
      await expect(failure).rejects.not.toThrow(/no quedó creado/);
    });

    it('si el commit falla, el correo con credenciales NO se envía (R3-001)', async () => {
      users.findOneByEmail.mockResolvedValue(null);
      grants.transaction.mockRejectedValue(new Error('commit failed'));

      await expect(service.createForOwner(BOND_ID, OWNER_ID, dto)).rejects.toThrow(
        'commit failed',
      );
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    it('con email existente manda un aviso sin credenciales, después del commit (D2)', async () => {
      users.findOneByEmail.mockResolvedValue({ id: TARGET_ID });
      members.findOneByBondAndUser.mockImplementation(async (_bondId: string, userId: string) =>
        userId === TARGET_ID ? null : progenitorMember,
      );
      grants.findActiveForPair.mockResolvedValue(null);
      const events: string[] = [];
      grants.transaction.mockImplementation(async (fn: (m: unknown) => Promise<unknown>) => {
        events.push('begin');
        const result = await fn(manager);
        events.push('commit');
        return result;
      });
      grants.saveWith.mockImplementation(async (data) => {
        events.push('grant');
        return grant({ ...data } as never);
      });
      mailer.sendMail.mockImplementation(async () => {
        events.push('mail');
      });

      await service.createForOwner(BOND_ID, OWNER_ID, dto);

      // No se crea cuenta ni se toca la contraseña existente.
      expect(userRowRepo.save).not.toHaveBeenCalled();
      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(events).toEqual(['begin', 'grant', 'commit', 'mail']);

      const mail = mailer.sendMail.mock.calls[0][0];
      expect(mail.to).toBe('abuela@example.com');
      expect(mail.text).toContain('Parental Coordination');
      expect(mail.text).toContain('12/12/2026');
      // Aviso, no credenciales.
      expect(mail.text).not.toMatch(/provisional/i);
      expect(mail.text).not.toContain('Usuario:');
    });

    it('si el aviso falla, el acceso queda igual y sólo se loguea (D2)', async () => {
      users.findOneByEmail.mockResolvedValue({ id: TARGET_ID });
      members.findOneByBondAndUser.mockImplementation(async (_bondId: string, userId: string) =>
        userId === TARGET_ID ? null : progenitorMember,
      );
      grants.findActiveForPair.mockResolvedValue(null);
      grants.saveWith.mockImplementation(async (data) => grant({ ...data } as never));
      mailer.sendMail.mockRejectedValue(new ServiceUnavailableException('sin SMTP'));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const created = await service.createForOwner(BOND_ID, OWNER_ID, dto);

      expect(created.status).toBe(AuthThirdStatus.ACTIVE);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('abuela@example.com');
      warn.mockRestore();
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

    it('vence de forma perezosa: marca expired y audita', async () => {
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
