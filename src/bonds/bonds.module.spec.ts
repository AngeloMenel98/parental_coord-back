import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ChildEntity } from '../children/entities/child.entity';
import { PersonalDataEntity } from '../users/entities/personal-data.entity';
import { BondAccessService } from './bond-access.service';
import { BondMembersRepository } from './repositories/bond-members.repository';
import { BondsModule } from './bonds.module';
import { BondsService } from './bonds.service';
import { BondEntity } from './entities/bond.entity';
import { BondMemberEntity } from './entities/bond-member.entity';

/**
 * El grafo de DI de `BondsModule`, igual que `reports.module.spec.ts`.
 *
 * Los specs de servicio construyen sus dependencias a mano, así que un provider
 * faltante en el módulo no lo ve nadie hasta el boot real. Pasó de verdad: la API
 * crasheaba al arrancar porque `BondAccessService` inyecta `Clock` y `BondsModule` no
 * lo proveía. Este test compila el módulo real y atrapa esa clase de hueco acá.
 */
describe('BondsModule wiring (T3/T12)', () => {
  const repoStub = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    createQueryBuilder: jest.fn(),
  });

  it('resuelve BondAccessService (necesita Clock) y BondsService', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [BondsModule] })
      .overrideProvider(getRepositoryToken(BondEntity))
      .useValue(repoStub())
      .overrideProvider(getRepositoryToken(BondMemberEntity))
      .useValue(repoStub())
      .overrideProvider(getRepositoryToken(ChildEntity))
      .useValue(repoStub())
      .overrideProvider(getRepositoryToken(PersonalDataEntity))
      .useValue(repoStub())
      .compile();

    expect(moduleRef.get(BondAccessService)).toBeInstanceOf(BondAccessService);
    expect(moduleRef.get(BondsService)).toBeInstanceOf(BondsService);
    expect(moduleRef.get(BondMembersRepository)).toBeInstanceOf(BondMembersRepository);
  });
});
