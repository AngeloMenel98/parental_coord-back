import { validate } from 'class-validator';
import { IsIso8601WithOffset } from './is-iso-8601-with-offset.validator';

class TestDto {
  @IsIso8601WithOffset()
  value!: string;
}

describe('IsIso8601WithOffset', () => {
  it('accepts Z and offset formats', async () => {
    const d1 = new TestDto();
    d1.value = '2026-10-05T10:00:00Z';
    const r1 = await validate(d1);
    expect(r1.length).toBe(0);

    const d2 = new TestDto();
    d2.value = '2026-10-05T10:00:00-03:00';
    const r2 = await validate(d2);
    expect(r2.length).toBe(0);
  });

  it('rejects invalid formats', async () => {
    const cases = ['2026-10-05T10:00:00', '2026-13-45T99:00:00Z', null, undefined, 123 as any];
    for (const c of cases) {
      const d = new TestDto();
      (d as any).value = c;
      const r = await validate(d);
      expect(r.length).toBeGreaterThan(0);
    }
  });
});
