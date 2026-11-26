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
import { AuthThirdPartiesRepository } from './repositories/auth-third-parties.repository';
import { ThirdPartiesAuditRepository } from './repositories/third-parties-audit.repository';
import { UpdateThirdPartyDto } from './dto/update-third-party.dto';
import { ThirdPartiesService } from './third-parties.service';

/**
 * S9 (thirdparty-identity): el PATCH de un acceso vigente acepta identidad. Un campo
 * presente se aplica (trim); un campo AUSENTE NO borra lo persistido — PATCH parcial,
 * mismo criterio que relationship/accessEnd/note.
 */
describe('ThirdPartiesService · PATCH de identidad (S9)', () => {
  const BOND_ID = '11111111-1111-1111-1111-111111111111';
  const OWNER_ID = '22222222-2222-2222-2222-222222222222';
  const GRANT_ID = '44444444-4444-4444-4444-444444444444';
  const TODAY = '2026-11-05';

  const grants = {
    findById: jest.fn(),
    transaction: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const access = { assertBondAccess: jest.fn() };
  const members = { findOneByBondAndUser: jest.fn(), findMemberNames: jest.fn() };
  const users = { findOneByEmail: jest.fn() };
  const mailer = { isConfigured: jest.fn(() => true), sendMail: jest.fn() };
  const clock = { now: jest.fn(() => new Date(`${TODAY}T12:00:00.000Z`)) };

  /** La fila VIVA que el manager del PATCH va a leer y guardar. */
  let row: AuthThirdPartyEntity;

  const grantRowRepo = {
    findOneByOrFail: jest.fn(async () => row),
    save: jest.fn(async (saved: AuthThirdPartyEntity) => {
      row = saved;
      return saved;
    }),
  };
  const manager = {
    getRepository: jest.fn(() => grantRowRepo),
  };

  let service: ThirdPartiesService;

  const grant = () =>
    ({
      id: GRANT_ID,
      bondId: BOND_ID,
      userId: '33333333-3333-3333-3333-333333333333',
      authorizedBy: OWNER_ID,
      startDate: '2026-11-01',
      endDate: '2026-12-12',
      relationship: ThirdPartyRelationship.FAMILY,
      status: AuthThirdStatus.ACTIVE,
      scopeNote: null,
      revokedAt: null,
      firstName: 'Abuela',
      lastName: 'Ana',
      phone: null,
      document: null,
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
    }) as AuthThirdPartyEntity;

  const dto = (overrides: Partial<UpdateThirdPartyDto> = {}): UpdateThirdPartyDto =>
    ({
      ...overrides,
    }) as UpdateThirdPartyDto;

  beforeEach(async () => {
    jest.clearAllMocks();
    row = grant();
    grants.transaction.mockImplementation(async (fn: (m: unknown) => Promise<unknown>) => fn(manager));
    grants.findById.mockResolvedValue(grant());
    members.findMemberNames.mockResolvedValue(new Map([[OWNER_ID, 'Ángelo']]));
    access.assertBondAccess.mockResolvedValue({
      role: BondMemberRole.PROGENITOR,
      isThirdParty: false,
    });

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

  it('un PATCH sólo de identidad aplica los campos presentes con trim', async () => {
    const response = await service.updateForOwner(
      GRANT_ID,
      OWNER_ID,
      dto({ firstName: '  Pablo ', lastName: ' Charles ', phone: ' +54 9 11 ', document: ' DNI ' }),
    );

    expect(row.firstName).toBe('Pablo');
    expect(row.lastName).toBe('Charles');
    expect(row.phone).toBe('+54 9 11');
    expect(row.document).toBe('DNI');
    expect(response.firstName).toBe('Pablo');
  });

  it('un PATCH sin identidad NO borra la identidad persistida', async () => {
    await service.updateForOwner(
      GRANT_ID,
      OWNER_ID,
      dto({ accessEnd: '2027-01-01' }),
    );

    expect(row.firstName).toBe('Abuela');
    expect(row.lastName).toBe('Ana');
    expect(row.endDate).toBe('2027-01-01');
  });

  it('phone y document vacíos limpian a null (limpieza explícita)', async () => {
    await service.updateForOwner(
      GRANT_ID,
      OWNER_ID,
      dto({ phone: '   ', document: '' }),
    );

    expect(row.phone).toBeNull();
    expect(row.document).toBeNull();
    expect(row.firstName).toBe('Abuela');
  });
});
