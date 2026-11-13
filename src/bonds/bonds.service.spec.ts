import { BondAccessService } from './bond-access.service';
import { BondsService } from './bonds.service';
import { BondsRepository } from './repositories/bonds.repository';

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

  let service: BondsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BondsService(
      bondRepo as unknown as BondsRepository,
      bondAccess as unknown as BondAccessService,
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
