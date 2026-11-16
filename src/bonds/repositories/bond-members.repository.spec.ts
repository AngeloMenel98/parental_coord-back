import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BondMemberEntity, BondMemberRole } from '../entities/bond-member.entity';
import { BondMembersRepository } from './bond-members.repository';

/**
 * `findActiveMemberIds` (REQ-3): query lean de destinatarios del gateway
 * realtime — sólo `user_id` de miembros con `left_at IS NULL`, sin JOINs ni
 * cálculo de compliance (distinto de `findActiveMembersWithActStats`).
 */
describe('BondMembersRepository — findActiveMemberIds (REQ-3)', () => {
  let repo: BondMembersRepository;
  let bondMemberRepo: any;
  let qb: any;

  beforeEach(async () => {
    qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    bondMemberRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      target: BondMemberEntity,
      manager: {},
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BondMembersRepository,
        { provide: getRepositoryToken(BondMemberEntity), useValue: bondMemberRepo },
      ],
    }).compile();

    repo = module.get(BondMembersRepository);
  });

  it('selects only user_id, filtered by bond_id and left_at IS NULL', async () => {
    await repo.findActiveMemberIds('bond-1');

    expect(bondMemberRepo.createQueryBuilder).toHaveBeenCalledWith('bm');
    expect(qb.select).toHaveBeenCalledWith('bm.user_id', 'userId');
    expect(qb.where).toHaveBeenCalledWith('bm.bond_id = :bondId', { bondId: 'bond-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('bm.left_at IS NULL');
  });

  it('stays lean: no JOINs, no compliance aggregation', async () => {
    await repo.findActiveMemberIds('bond-1');

    expect(qb.innerJoin).not.toHaveBeenCalled();
    expect(qb.leftJoin).not.toHaveBeenCalled();
    expect(qb.groupBy).not.toHaveBeenCalled();
  });

  it('maps the raw rows to a string[] of user ids', async () => {
    qb.getRawMany.mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }]);

    expect(await repo.findActiveMemberIds('bond-1')).toEqual(['u1', 'u2']);
  });

  it('returns an empty array when there is no active member', async () => {
    expect(await repo.findActiveMemberIds('bond-1')).toEqual([]);
  });
});

/**
 * `findThirdPartyAuthorizers` (T12/S12): quién autorizó a cada tercero con acceso
 * VIVO del vínculo. El join replica el del gateway/fan-out: un grant revocado o
 * vencido no autoriza nada que anunciar.
 */
describe('BondMembersRepository — findThirdPartyAuthorizers (T12)', () => {
  let repo: BondMembersRepository;
  let qb: any;

  beforeEach(async () => {
    qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    const bondMemberRepo = {
      createQueryBuilder: jest.fn(),
      target: BondMemberEntity,
      manager: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BondMembersRepository,
        { provide: getRepositoryToken(BondMemberEntity), useValue: bondMemberRepo },
      ],
    }).compile();

    repo = module.get(BondMembersRepository);
  });

  it('filtra por grant vivo: activo, sin left_at y no vencido', async () => {
    await repo.findThirdPartyAuthorizers('bond-1');

    expect(qb.select).toHaveBeenCalledWith('bm.user_id', 'userId');
    expect(qb.addSelect).toHaveBeenCalledWith('g.authorized_by', 'authorizedBy');
    expect(qb.innerJoin).toHaveBeenCalledWith(
      'auth_third_party',
      'g',
      expect.stringContaining("g.status = 'active'"),
    );
    expect(qb.where).toHaveBeenCalledWith('bm.bond_id = :bondId', { bondId: 'bond-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('bm.left_at IS NULL');
    expect(qb.andWhere).toHaveBeenCalledWith('g.end_date >= CURRENT_DATE');
  });

  it('mapea tercero → autorizador', async () => {
    qb.getRawMany.mockResolvedValueOnce([{ userId: 't1', authorizedBy: 'p1' }]);

    const map = await repo.findThirdPartyAuthorizers('bond-1');

    expect(map.get('t1')).toBe('p1');
    expect(map.size).toBe(1);
  });

  it('devuelve un mapa vacío cuando ningún tercero tiene grant vivo', async () => {
    expect((await repo.findThirdPartyAuthorizers('bond-1')).size).toBe(0);
  });
});

/**
 * `findActiveMembersWithActStats` (S5/S12, advisory A2 de L29): el cumplimiento del
 * vínculo es de los PROGENITORES. El trabajo del tercero es individual y no suma al
 * porcentaje, y el otro progenitor no lo ve listado con su nombre real.
 *
 * El rol excluido se vincula como parámetro (`:thirdPartyRole`): el literal
 * `third_party` NO se interpola en el SQL.
 */
describe('BondMembersRepository — findActiveMembersWithActStats (S5/S12/A2)', () => {
  let repo: BondMembersRepository;
  let qb: any;
  const FROM = new Date('2026-02-01T00:00:00.000Z');
  const TO = new Date('2026-03-01T00:00:00.000Z');

  beforeEach(async () => {
    qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    const bondMemberRepo = {
      createQueryBuilder: jest.fn(),
      target: BondMemberEntity,
      manager: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BondMembersRepository,
        { provide: getRepositoryToken(BondMemberEntity), useValue: bondMemberRepo },
      ],
    }).compile();

    repo = module.get(BondMembersRepository);
  });

  /** Todas las condiciones `andWhere` en el orden en que se encadenaron. */
  const whereClauses = () => qb.andWhere.mock.calls.map((call: any[]) => call[0] as string);

  it('excluye a los terceros temporales del cálculo', async () => {
    await repo.findActiveMembersWithActStats('bond-1', FROM, TO);

    expect(qb.andWhere).toHaveBeenCalledWith('bm.role <> :thirdPartyRole', {
      thirdPartyRole: BondMemberRole.THIRD_PARTY,
    });
  });

  it('vincula el rol excluido como parámetro: el literal no viaja interpolado en el SQL', async () => {
    await repo.findActiveMembersWithActStats('bond-1', FROM, TO);

    const sql = whereClauses().join(' AND ');
    expect(sql).toContain(':thirdPartyRole');
    expect(sql).not.toMatch(/third_party/i);
  });

  it('conserva los filtros y agregados previos (bond activo, rango y nombre)', async () => {
    await repo.findActiveMembersWithActStats('bond-1', FROM, TO);

    expect(qb.select).toHaveBeenCalledWith('bm.user_id', 'userId');
    expect(qb.from).toHaveBeenCalledWith('bond_member', 'bm');
    expect(qb.innerJoin).toHaveBeenCalledWith('personal_data', 'pd', 'pd.user_id = bm.user_id');
    expect(qb.leftJoin).toHaveBeenCalledWith(
      'activity',
      'a',
      expect.stringContaining('a.assigned_to = bm.user_id'),
      { from: FROM, to: TO },
    );
    expect(qb.where).toHaveBeenCalledWith('bm.bond_id = :bondId', { bondId: 'bond-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('bm.left_at IS NULL');
    expect(qb.groupBy).toHaveBeenCalledWith('bm.user_id');
    expect(qb.addGroupBy).toHaveBeenCalledWith('pd.first_name');
    expect(qb.addGroupBy).toHaveBeenCalledWith('pd.last_name');
  });

  it('sigue devolviendo las filas crudas de cumplimiento que arma el servicio', async () => {
    qb.getRawMany.mockResolvedValueOnce([
      { userId: 'p1', firstName: 'Ana', lastName: 'Pérez', total: 4, completed: 3 },
    ]);

    await expect(repo.findActiveMembersWithActStats('bond-1', FROM, TO)).resolves.toEqual([
      { userId: 'p1', firstName: 'Ana', lastName: 'Pérez', total: 4, completed: 3 },
    ]);
  });
});
