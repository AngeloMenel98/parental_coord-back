import { BondsService } from './bonds.service';

/**
 * T12/S12 — probes de la verificación independiente.
 *
 * La spec original de `bonds.service.spec.ts` usa **un solo progenitor**, así que una
 * implementación que adivinara "el primer progenitor del vínculo" en vez de leer
 * `auth_third_party.authorized_by` habría pasado igual. Estos casos cierran ese hueco:
 * dos progenitores (el autorizador es el segundo), autorizador sin datos personales,
 * inmutabilidad de la entidad cargada y presupuesto de consultas por vínculo.
 */

const REAL = { firstName: 'Tere', lastName: 'Tercera', avatarUrl: 'tere.png' };

const bond = (id = 'b1') => ({
  id,
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
      id: 'm3',
      role: 'progenitor',
      joinedAt: null,
      user: {
        id: 'p2',
        systemRole: 'user',
        personalData: { firstName: 'Beto', lastName: 'Ruiz', avatarUrl: 'beto.png' },
      },
    },
    { id: 'm2', role: 'third_party', joinedAt: null, user: { id: 't1', systemRole: 'user', personalData: { ...REAL } } },
  ],
  children: [],
});

const NAMES = new Map([
  ['p1', 'Ana Paz'],
  ['p2', 'Beto Ruiz'],
  ['t1', 'Tere Tercera'],
]);

const build = (bonds: unknown[], viewer: unknown, authorizers: Map<string, string>) => {
  const repo = { findBondsByUserId: jest.fn(async () => bonds) };
  const access = { resolveBondAccess: jest.fn(async () => viewer) };
  const members = {
    findThirdPartyAuthorizers: jest.fn(async () => authorizers),
    findMemberNames: jest.fn(async () => NAMES),
  };
  const service = new (BondsService as any)(repo, access, members);
  return { service, members };
};

const parent = { role: 'progenitor', isThirdParty: false };

describe('T12 · identidad del tercero (probes)', () => {
  it('atribuye al autorizador real de auth_third_party, no al primer progenitor', async () => {
    const { service } = build([bond()], parent, new Map([['t1', 'p2']]));

    const [dto] = await service.findByUserId('p1');
    const third = dto.members.find((m: any) => m.role === 'third_party');

    expect(third.user.firstName).toBe('Autorizado por Beto Ruiz');
    expect(JSON.stringify(dto)).not.toContain('Tere');
  });

  it('autorizador sin datos personales: oculta en vez de filtrar', async () => {
    const { service } = build([bond()], parent, new Map([['t1', 'p3']]));

    const [dto] = await service.findByUserId('p1');
    const third = dto.members.find((m: any) => m.role === 'third_party');

    expect(third.user.firstName).toBeNull();
    expect(JSON.stringify(dto)).not.toContain('Tere');
  });

  it('no muta la entidad cargada ni acumula la frase entre requests', async () => {
    const loaded = bond();
    const { service } = build([loaded], parent, new Map([['t1', 'p2']]));

    await service.findByUserId('p1');
    expect((loaded.members[2] as any).user.personalData).toEqual(REAL);

    const [again] = await service.findByUserId('p1');
    const third = again.members.find((m: any) => m.role === 'third_party');
    expect(third.user.firstName).toBe('Autorizado por Beto Ruiz');
  });

  it('dos terceros en un vínculo: un par de consultas, no una por miembro', async () => {
    const loaded = bond();
    loaded.members.push({
      id: 'm4',
      role: 'third_party',
      joinedAt: null,
      user: {
        id: 't2',
        systemRole: 'user',
        personalData: { firstName: 'Otro', lastName: 'Tercero', avatarUrl: 'o.png' },
      },
    } as (typeof loaded.members)[number]);

    const { service, members } = build(
      [loaded],
      parent,
      new Map([
        ['t1', 'p2'],
        ['t2', 'p2'],
      ]),
    );

    const [dto] = await service.findByUserId('p1');

    expect(members.findThirdPartyAuthorizers).toHaveBeenCalledTimes(1);
    expect(members.findMemberNames).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(dto)).not.toContain('Otro');
  });
});
