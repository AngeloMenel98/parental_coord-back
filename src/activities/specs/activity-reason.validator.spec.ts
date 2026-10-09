import {
  ACTIVITY_REASON_MAX,
  ACTIVITY_REASON_MIN,
  validateActivityReason,
} from '../dto/activity-reason.validator';

describe('validateActivityReason (shared by Cancelar and No asistir)', () => {
  it('exposes the shared bounds 3–200', () => {
    expect(ACTIVITY_REASON_MIN).toBe(3);
    expect(ACTIVITY_REASON_MAX).toBe(200);
  });

  describe('accepted', () => {
    it('accepts exactly 3 characters (the lower bound is inclusive)', () => {
      const r = validateActivityReason('abc');
      expect(r).toEqual({ ok: true, value: 'abc' });
    });

    it('accepts exactly 200 characters (the upper bound is inclusive)', () => {
      const r = validateActivityReason('a'.repeat(200));
      expect(r.ok).toBe(true);
    });

    it('trims surrounding whitespace so padding cannot fake the 3-char minimum', () => {
      const r = validateActivityReason('   abc   ');
      expect(r).toEqual({ ok: true, value: 'abc' });
    });

    it('counts the TRIMMED length, so 200 chars + spaces still passes', () => {
      const r = validateActivityReason(`  ${'a'.repeat(200)}  `);
      expect(r.ok).toBe(true);
    });

    it('keeps interior spaces — "no  puedo" is a valid, distinct reason', () => {
      const r = validateActivityReason('no  puedo');
      expect(r).toEqual({ ok: true, value: 'no  puedo' });
    });

    it('accepts non-latin text and counts characters, not bytes', () => {
      const r = validateActivityReason('motivo con ñ y á — válido');
      expect(r.ok).toBe(true);
    });
  });

  describe('rejected', () => {
    it('rejects undefined as `missing`', () => {
      expect(validateActivityReason(undefined)).toMatchObject({ ok: false, reason: 'missing' });
    });

    it('rejects null as `missing`', () => {
      expect(validateActivityReason(null)).toMatchObject({ ok: false, reason: 'missing' });
    });

    it('rejects 2 characters as `too_short`', () => {
      expect(validateActivityReason('ab')).toMatchObject({ ok: false, reason: 'too_short' });
    });

    it('rejects whitespace-only as `too_short` — not a valid reason', () => {
      expect(validateActivityReason('     ')).toMatchObject({ ok: false, reason: 'too_short' });
    });

    it('rejects 201 characters as `too_long`', () => {
      expect(validateActivityReason('a'.repeat(201))).toMatchObject({
        ok: false,
        reason: 'too_long',
      });
    });

    it('rejects a non-string as `not_a_string` (a number body must 422, not 400)', () => {
      expect(validateActivityReason(123)).toMatchObject({ ok: false, reason: 'not_a_string' });
    });

    it('rejects an object body as `not_a_string`', () => {
      expect(validateActivityReason({ a: 1 })).toMatchObject({ ok: false, reason: 'not_a_string' });
    });

    it('rejects a boolean body as `not_a_string`', () => {
      expect(validateActivityReason(true)).toMatchObject({ ok: false, reason: 'not_a_string' });
    });

    it('always carries a human-readable message', () => {
      const r = validateActivityReason('ab');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message).toContain('3');
      }
    });
  });
});
