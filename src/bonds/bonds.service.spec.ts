import { BondAccessService } from './bond-access.service';
import { BondsService } from './bonds.service';
import { BondsRepository } from './repositories/bonds.repository';
import { BondMembersRepository } from './repositories/bond-members.repository';

/**
 * T3 · la bisagra de la tenencia.
 *
 * `isActiveBondForMember` es el método que usan todos los dominios para autorizar. Lo que
 * se prueba acá es que **consulta el chokepoint** y que un tercero sin grant vivo no
 * cuenta como miembro activo: si esto se rompe, un acceso revocado vuelve a servir en
 * todo el backend a la vez.
 */
describe('BondsService.isActiveBondForMember', () => {
  const BOND_ID = '11111111-1111-1111-1111-111111111111';
  const USER_ID = '22222222-2222-2222-2222-222222222222';

  const bondRepo = { findBondsByUserId: jest.fn() };
  const bondAccess = { resolveBondAccess: jest.fn() };
  const bondMembers = { findThirdPartyAuthorizers: jest.fn(), findMemberNames: jest.fn() };

  let service: BondsService;

  beforeEach(() => {
    jest.clearAllMocks();
    bondMembers.findThirdPartyAuthorizers.mockResolvedValue(new Map());
    bondMembers.findMemberNames.mockResolvedValue(new Map());
    service = new BondsService(
      bondRepo as unknown as BondsRepository,
      bondAccess as unknown as BondAccessService,
      bondMembers as unknown as BondMembersRepository,
    );
  });

  it('delega en el chokepoint', async () => {
    bondAccess.resolveBondAccess.mockResolvedValue({ role: 'progenitor', isThirdParty: false });

    await expect(service.isActiveBondForMember(BOND_ID, USER_ID)).resolves.toBe(true);
    expect(bondAccess.resolveBondAccess).toHaveBeenCalledWith(BOND_ID, USER_ID);
  });

  it('sin membresía no es miembro activo', async () => {
    bondAccess.resolveBondAccess.mockResolvedValue(null);

    await expect(service.isActiveBondForMember(BOND_ID, USER_ID)).resolves.toBe(false);
  });

  it('un tercero con grant vigente sí cuenta', async () => {
    bondAccess.resolveBondAccess.mockResolvedValue({
      role: 'third_party',
      isThirdParty: true,
      grant: { id: 'g-1', authorizedBy: 'p-1', startDate: '2026-10-01', endDate: '2026-12-12' },
    });

    await expect(service.isActiveBondForMember(BOND_ID, USER_ID)).resolves.toBe(true);
  });

  it('un tercero sin grant vigente NO cuenta, aunque siga en bond_member', async () => {
    bondAccess.resolveBondAccess.mockResolvedValue({
      role: 'third_party',
      isThirdParty: true,
      grant: undefined,
    });

    await expect(service.isActiveBondForMember(BOND_ID, USER_ID)).resolves.toBe(false);
  });
});

describe('BondsService.findByUserId · S5 redacción del vínculo', () => {
  const bond = (id: string) => ({
    id,
    title: null,
    agreementType: null,
    courtCaseRef: null,
    startDate: null,
    endDate: null,
    isActive: true,
    members: [{ id: 'm1', role: 'progenitor', user: { id: 'p1', firstName: 'Ana' } }],
    children: [{ id: 'c1', firstName: 'Emma', lastName: 'P' }],
  });

  it('al tercero le vacía miembros e hijos; al progenitor no', async () => {
    const repo = { findBondsByUserId: jest.fn(async () => [bond('b1')]) };
    const access = {
      resolveBondAccess: jest
        .fn()
        .mockResolvedValueOnce({ role: 'progenitor', isThirdParty: false })
        .mockResolvedValueOnce({ role: 'third_party', isThirdParty: true }),
    };

    const { BondsService } = await import('./bonds.service');
    const members = { findThirdPartyAuthorizers: jest.fn(), findMemberNames: jest.fn() };
    const service = new (BondsService as any)(repo, access, members);

    const forProgenitor = await service.findByUserId('p1');
    const forThirdParty = await service.findByUserId('t1');

    expect((forProgenitor[0] as any).members.length).toBe(1);
    expect((forProgenitor[0] as any).children.length).toBe(1);
    expect((forThirdParty[0] as any).members.length).toBe(0);
    expect((forThirdParty[0] as any).children.length).toBe(0);
    // El vínculo sigue visible: se redacta el contenido, no la pertenencia.
    expect((forThirdParty[0] as any).id).toBe('b1');
  });
});

describe('BondsService.findByUserId · S12/T12 identidad del tercero', () => {
  const bondWithThirdParty = () => ({
    id: 'b1',
    title: null,
    agreementType: null,
    courtCaseRef: null,
    startDate: null,
    endDate: null,
    isActive: true,
    members: [
      {
        id: 'm1',
        role: 'progenitor',
        joinedAt: null,
        user: {
          id: 'p1',
          systemRole: 'user',
          personalData: { firstName: 'Ana', lastName: 'Paz', avatarUrl: 'ana.png' },
        },
      },
      {
        id: 'm2',
        role: 'third_party',
        joinedAt: null,
        user: {
          id: 't1',
          systemRole: 'user',
          personalData: { firstName: 'Tere', lastName: 'Tercera', avatarUrl: 'tere.png' },
        },
      },
    ],
    children: [],
  });

  const buildService = (
    bond: unknown,
    access: unknown,
    authorizers: Map<string, string>,
    names: Map<string, string>,
  ) => {
    const repo = { findBondsByUserId: jest.fn(async () => [bond]) };
    const members = {
      findThirdPartyAuthorizers: jest.fn(async () => authorizers),
      findMemberNames: jest.fn(async () => names),
    };
    const service = new (BondsService as any)(repo, { resolveBondAccess: jest.fn(async () => access) }, members);
    return { service, members };
  };

  const PROGENITOR_VIEWER = { role: 'progenitor', isThirdParty: false };
  const THIRD_PARTY_VIEWER = {
    role: 'third_party',
    isThirdParty: true,
    grant: { id: 'g-1', authorizedBy: 'p1', startDate: '2026-10-01', endDate: '2026-12-12' },
  };

  it('al progenitor le muestra quién lo autorizó, con nombre y perfil vaciados', async () => {
    const { service } = buildService(
      bondWithThirdParty(),
      PROGENITOR_VIEWER,
      new Map([['t1', 'p1']]),
      // El mapa trae el nombre real del tercero a propósito: si el servicio lo usara,
      // estas aserciones fallarían.
      new Map([
        ['p1', 'Ana Paz'],
        ['t1', 'Tere Tercera'],
      ]),
    );

    const [dto] = await service.findByUserId('p1');
    const third = dto.members.find((m: any) => m.role === 'third_party');

    expect(third.user.firstName).toBe('Autorizado por Ana Paz');
    expect(third.user.lastName).toBeNull();
    expect(third.user.avatarUrl).toBeNull();
    // El id sigue siendo la llave del miembro: la app lo necesita para asignar y revocar.
    expect(third.user.id).toBe('t1');
    expect(JSON.stringify(dto)).not.toContain('Tere');
  });

  it('al tercero no se le hace ninguna consulta: su vínculo viene redactado', async () => {
    const { service, members } = buildService(
      bondWithThirdParty(),
      THIRD_PARTY_VIEWER,
      new Map([['t1', 'p1']]),
      new Map([['p1', 'Ana Paz']]),
    );

    const [dto] = await service.findByUserId('t1');

    expect(dto.members).toHaveLength(0);
    expect(members.findThirdPartyAuthorizers).not.toHaveBeenCalled();
    expect(members.findMemberNames).not.toHaveBeenCalled();
  });

  it('sin grant vivo esconde la identidad en vez de caer al nombre del tercero', async () => {
    const { service } = buildService(
      bondWithThirdParty(),
      PROGENITOR_VIEWER,
      new Map(),
      new Map([
        ['p1', 'Ana Paz'],
        ['t1', 'Tere Tercera'],
      ]),
    );

    const [dto] = await service.findByUserId('p1');
    const third = dto.members.find((m: any) => m.role === 'third_party');

    expect(third.user.firstName).toBeNull();
    expect(third.user.lastName).toBeNull();
    expect(third.user.avatarUrl).toBeNull();
    expect(JSON.stringify(dto)).not.toContain('Tere');
  });

  it('sin terceros en el vínculo no agrega consultas (caso común)', async () => {
    const bond = bondWithThirdParty();
    bond.members = [bond.members[0] as (typeof bond.members)[number]];
    const { service, members } = buildService(bond, PROGENITOR_VIEWER, new Map(), new Map());

    await service.findByUserId('p1');

    expect(members.findThirdPartyAuthorizers).not.toHaveBeenCalled();
    expect(members.findMemberNames).not.toHaveBeenCalled();
  });
});
