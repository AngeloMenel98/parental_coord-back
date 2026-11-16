import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BondMemberEntity } from '../entities/bond-member.entity';
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
