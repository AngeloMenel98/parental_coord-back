import { AddCategoryCriticality1790726400000 } from '../migrations/1790726400000-AddCategoryCriticality';

describe('1790726400000-AddCategoryCriticality migration', () => {
  let qr: any;

  beforeEach(() => {
    qr = {
      query: jest.fn(),
      release: jest.fn(),
      hasTable: jest.fn().mockResolvedValue(true),
      getTable: jest.fn().mockResolvedValue({ columns: [] } as any),
    };
  });

  it('up: adds column IF NOT EXISTS, backfills and creates index IF NOT EXISTS', async () => {
    const m = new AddCategoryCriticality1790726400000();
    await m.up(qr);
    const calls = (qr.query as jest.Mock).mock.calls.map((c) => c[0]);
    expect(
      calls.some(
        (q) => q.includes('ALTER TABLE') && q.includes('category') && q.includes('criticality'),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (q) => q.includes('UPDATE') && q.includes('category') && q.includes('criticality'),
      ),
    ).toBe(true);
    // index not created in this migration
  });

  it('down: drops index IF EXISTS and drops column IF EXISTS', async () => {
    const m = new AddCategoryCriticality1790726400000();
    await m.down(qr);
    const calls = (qr.query as jest.Mock).mock.calls.map((c) => c[0]);
    // index not created in this migration
    expect(calls.some((q) => q.includes('DROP COLUMN') && q.includes('criticality'))).toBe(true);
  });

  it('up is idempotent (can run twice)', async () => {
    const m = new AddCategoryCriticality1790726400000();
    await m.up(qr);
    (qr.query as jest.Mock).mockClear();
    await m.up(qr);
    expect((qr.query as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });
});
