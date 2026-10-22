import { classify } from './classify';

/**
 * Tabla de vectores de clasificación (T-W1.21, REQ-DEL-2, AC-13, OQ-F).
 */
describe('classify (REQ-DEL-2, AC-13)', () => {
  it.each([
    [200, false, 'SUCCESS'],
    [201, false, 'SUCCESS'],
    [204, false, 'SUCCESS'],
    [299, false, 'SUCCESS'],
    [301, false, 'TERMINAL'], // OQ-F: 3xx terminal (redirect no seguido)
    [302, false, 'TERMINAL'],
    [308, false, 'TERMINAL'],
    [400, false, 'TERMINAL'],
    [401, false, 'TERMINAL'],
    [404, false, 'TERMINAL'],
    [410, false, 'DISABLE'],
    [408, false, 'RETRY'],
    [429, false, 'RETRY'],
    [500, false, 'RETRY'],
    [502, false, 'RETRY'],
    [503, false, 'RETRY'],
    [null, true, 'RETRY'], // red/timeout
    [null, false, 'TERMINAL'], // bloqueo SSRF (sin status, sin error de red)
  ] as const)('classify(%s, networkError=%s) → %s', (status, networkError, expected) => {
    expect(classify(status, networkError)).toBe(expected);
  });

  it('treats a network error with a status as retryable', () => {
    expect(classify(500, true)).toBe('RETRY');
  });
});
