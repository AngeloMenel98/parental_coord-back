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
