import { Test } from '@nestjs/testing';

import { BondMemberRole } from '../bonds/entities/bond-member.entity';
import { BondAccessService } from '../bonds/bond-access.service';
import { BondMembersRepository } from '../bonds/repositories/bond-members.repository';
import { Clock } from '../common/clock/clock';
import {
  AuthThirdPartyEntity,
  AuthThirdStatus,
  ThirdPartyRelationship,
} from '../expenses/entities/auth-third-party.entity';
import { MailerService } from '../mail/mailer.service';
import { UsersRepository } from '../users/repositories/users.repository';
import {
  AuthThirdPartiesRepository,
} from './repositories/auth-third-parties.repository';
import {
  ThirdPartiesAuditRepository,
} from './repositories/third-parties-audit.repository';
import { CreateThirdPartyDto } from './dto/create-third-party.dto';
import { ThirdPartiesService } from './third-parties.service';

/**
 * S1/S4 de `odd/tasks/thirdparty-identity.md`: la identidad declarada del tercero
 * (firstName/lastName/phone/document) se persiste en el grant y viaja en la respuesta.
 *
 * Mismo patrón que `third-parties.service.spec.ts`: repositorios dobles, la
 * transacción ejecutada sobre un manager falso. Se afirma sobre el argumento
 * capturado por el save del repo de grants (sin DB real). El DTO nuevo ya incluye
 * los cuatro campos obligatorios/opcionales según S1.
 */
describe('ThirdPartiesService · identidad del grant (S1/S4)', () => {
  const BOND_ID = '11111111-1111-1111-1111-111111111111';
  const OWNER_ID = '22222222-2222-2222-2222-222222222222';
  const TARGET_ID = '33333333-3333-3333-3333-333333333333';
  const GRANT_ID = '44444444-4444-4444-4444-444444444444';
  const TODAY = '2026-11-05';

  const grants = {
    findActiveForPair: jest.fn(),
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
    find: jest.fn(async (): Promise<AuthThirdPartyEntity[]> => []),
    save: jest.fn(),
    update: jest.fn(async () => ({ affected: 1 })),
  };
  const memberRowRepo = {
    create: jest.fn((data) => data),
    save: jest.fn(async (data) => data),
    update: jest.fn(async () => ({ affected: 1 })),
  };
  const userRowRepo = {
    create: jest.fn((data) => data),
    save: jest.fn(async (data: Record<string, unknown>) => ({ id: TARGET_ID, ...data })),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity?.name === 'BondMemberEntity') return memberRowRepo;
      if (entity?.name === 'UserEntity') return userRowRepo;
      return grantRowRepo;
    }),
  };

  let service: ThirdPartiesService;

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
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      ...overrides,
    }) as AuthThirdPartyEntity;

  const dto = (overrides: Partial<CreateThirdPartyDto> = {}): CreateThirdPartyDto =>
    ({
      email: 'pablo@example.com',
      relationship: ThirdPartyRelationship.CAREGIVER,
      accessEnd: '2026-12-12',
      firstName: '  Pablo  ',
      lastName: '  Charles  ',
      phone: undefined,
      document: undefined,
      ...overrides,
    }) as CreateThirdPartyDto;

  beforeEach(async () => {
    jest.clearAllMocks();
    grants.transaction.mockImplementation(async (fn: (m: unknown) => Promise<unknown>) => fn(manager));
    grants.saveWith.mockImplementation(async (data: Record<string, unknown>) => ({
      ...grant(),
      ...data,
    }));
    grantRowRepo.save.mockImplementation(async (row) => row);
    memberRowRepo.save.mockImplementation(async (data) => data);
    mailer.sendMail.mockResolvedValue(undefined);
    members.findMemberNames.mockResolvedValue(new Map([[OWNER_ID, 'Ángelo']]));
    access.assertBondAccess.mockResolvedValue({
      role: BondMemberRole.PROGENITOR,
      isThirdParty: false,
    });
    users.findOneByEmail.mockResolvedValue({ id: TARGET_ID, email: 'pablo@example.com' });
    members.findOneByBondAndUser.mockResolvedValue(null);

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

  it('persiste la identidad declarada en el alta (S1)', async () => {
    await service.createForOwner(BOND_ID, OWNER_ID, dto());

    expect(grants.saveWith).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Pablo',
        lastName: 'Charles',
        phone: null,
        document: null,
      }),
      manager,
    );
  });

  it('trims firstName y lastName, y persiste phone/document opcionales', async () => {
    await service.createForOwner(
      BOND_ID,
      OWNER_ID,
      dto({ phone: ' +54 9 11 5555-5555 ', document: ' DNI 34.567.890 ' }),
    );

    expect(grants.saveWith).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Pablo',
        lastName: 'Charles',
        phone: '+54 9 11 5555-5555',
        document: 'DNI 34.567.890',
      }),
      manager,
    );
  });

  it('la respuesta del alta lleva la identidad (S4)', async () => {
    const response = await service.createForOwner(BOND_ID, OWNER_ID, dto());

    expect(response.firstName).toBe('Pablo');
    expect(response.lastName).toBe('Charles');
    expect(response.phone).toBeNull();
    expect(response.document).toBeNull();
  });

  it('filas previas a la feature (sin identidad) degradan a null sin romper (S6)', async () => {
    grants.saveWith.mockImplementation(async (data: Record<string, unknown>) => ({
      ...grant(),
      ...data,
      firstName: null,
      lastName: null,
      phone: null,
      document: null,
    }));

    const response = await service.createForOwner(BOND_ID, OWNER_ID, dto());

    expect(response.firstName).toBeNull();
    expect(response.lastName).toBeNull();
  });
});
