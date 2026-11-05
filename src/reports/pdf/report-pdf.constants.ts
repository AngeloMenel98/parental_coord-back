import { BondReport } from '../build-bond-report';

export const REPORT_PDF_QUEUE = 'report-pdf';

/** Token de DI para el render: en producción es pdfkit, en los tests un stub. */
export const REPORT_PDF_RENDERER = Symbol('REPORT_PDF_RENDERER');

export type BondReportRenderer = (report: BondReport) => Promise<Buffer>;

export interface ReportPdfJobData {
  reportId: string;
}
