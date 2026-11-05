import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { DatabaseProbe } from './database-probe';

describe('DatabaseProbe', () => {
  let probe: DatabaseProbe;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [DatabaseProbe, { provide: DataSource, useValue: dataSource }],
    }).compile();
    probe = module.get<DatabaseProbe>(DatabaseProbe);
  });

  it('ping queries SELECT 1', async () => {
    dataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);
    await probe.ping();
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('ping propagates rejection', async () => {
    dataSource.query.mockRejectedValue(new Error('connection refused'));
    await expect(probe.ping()).rejects.toThrow('connection refused');
  });
});
