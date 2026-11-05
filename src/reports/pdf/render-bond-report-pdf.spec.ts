import { buildBondReport, BondReport } from '../build-bond-report';
import { renderBondReportPdf } from './render-bond-report-pdf';

/** B3 · S11 — el PDF es un PDF de verdad, no un texto con extensión. */
describe('renderBondReportPdf (B3)', () => {
  const generatedAt = new Date('2026-06-30T12:00:00.000Z');

  const emptyReport = (): BondReport =>
    buildBondReport({
      bondId: 'bond-1',
      bondTitle: 'Acuerdo Paz',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
      generatedAt,
      activities: [],
      expenses: [],
      categories: [],
      children: [],
      childActivityCounts: {},
      members: [],
    });

  it('S11 renders a document with a PDF header', async () => {
    const buffer = await renderBondReportPdf(emptyReport());

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('S11 renders an empty bond without throwing', async () => {
    await expect(renderBondReportPdf(emptyReport())).resolves.toBeInstanceOf(Buffer);
  });

  it('S11 grows the document when the report carries data', async () => {
    const base = emptyReport();
    const fullReport = buildBondReport({
      bondId: 'bond-1',
      bondTitle: 'Acuerdo Paz',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
      generatedAt,
      activities: Array.from({ length: 40 }, () => ({
        status: 'done' as never,
        criticality: 'high' as never,
        deadline: null,
        assignedTo: 'u1',
      })),
      expenses: [{ status: 'paid' as never, amount: 1234.56, categoryId: null, deletedAt: null }],
      categories: [],
      children: [{ id: 'c1', firstName: 'Mateo', lastName: 'Paz', dateOfBirth: '2020-05-15' }],
      childActivityCounts: { c1: 3 },
      members: [{ userId: 'u1', firstName: 'Ana', lastName: 'Paz', role: 'progenitor' }],
    });

    const empty = await renderBondReportPdf(base);
    const full = await renderBondReportPdf(fullReport);

    expect(full.length).toBeGreaterThan(empty.length);
  });
});
