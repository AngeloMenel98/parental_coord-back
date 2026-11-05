import * as PDFDocument from 'pdfkit';

import { BondReport } from '../build-bond-report';

/**
 * B3 · S11 — render del reporte de vínculo a PDF.
 *
 * Función sin Nest ni base de datos: recibe el JSON que ya devuelve
 * `GET /admin/bonds/:bondId/report` y devuelve los bytes. El worker la usa tal
 * cual, así que el PDF y el JSON no pueden divergir.
 */

const MARGIN = 48;
const HEADING = '#1f2937';
const MUTED = '#6b7280';
const ACCENT = '#2563eb';

const money = (value: number): string =>
  value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const percent = (value: number): string => `${value.toFixed(2)}%`;

export function renderBondReportPdf(report: BondReport): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      info: { Title: 'Reporte de vínculo' },
    });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const heading = (text: string): void => {
      doc.moveDown(0.8);
      doc.fillColor(ACCENT).fontSize(13).text(text.toUpperCase());
      doc
        .moveTo(MARGIN, doc.y + 2)
        .lineTo(doc.page.width - MARGIN, doc.y + 2)
        .strokeColor(ACCENT)
        .lineWidth(0.8)
        .stroke();
      doc.moveDown(0.4);
      doc.fillColor(HEADING).fontSize(10);
    };

    const line = (label: string, value: string): void => {
      doc.fillColor(MUTED).text(label, { continued: true });
      doc.fillColor(HEADING).text(`  ${value}`);
    };

    doc.fillColor(HEADING).fontSize(18).text('Reporte de vínculo');
    doc.moveDown(0.2);
    doc.fillColor(MUTED).fontSize(10);
    doc.text(report.bondTitle);
    doc.text(`Período: ${report.dateFrom} → ${report.dateTo}`);
    doc.text(`Generado: ${report.generatedAt}`);

    heading('Actividades');
    line('Total', String(report.activities.total));
    line('Completadas', String(report.activities.completed));
    line('Vencidas', String(report.activities.overdue));
    line('Cumplimiento', percent(report.activities.completionRate));
    const statuses = Object.entries(report.activities.byStatus);
    if (statuses.length > 0) {
      doc.moveDown(0.3);
      line('Por estado', statuses.map(([status, count]) => `${status}: ${count}`).join(' · '));
    }
    const criticalities = Object.entries(report.activities.byCriticality);
    if (criticalities.length > 0) {
      line(
        'Por criticidad',
        criticalities.map(([level, count]) => `${level}: ${count}`).join(' · '),
      );
    }

    heading('Gastos');
    line('Total', money(report.expenses.totalAmount));
    line(
      'Pagado',
      `${money(report.expenses.paidAmount)} (${percent(report.expenses.paidAmountPercentage)} por monto)`,
    );
    line('Pagado (cantidad)', percent(report.expenses.paidCountPercentage));
    line('Pendiente', money(report.expenses.pendingAmount));
    if (report.expenses.byCategory.length > 0) {
      doc.moveDown(0.3);
      for (const category of report.expenses.byCategory) {
        line(
          category.categoryName ?? 'Sin categoría',
          `${money(category.amount)} · ${category.count} gasto(s)`,
        );
      }
    }

    heading('Hijos del vínculo');
    if (report.children.length === 0) {
      doc.fillColor(MUTED).text('Sin hijos registrados.');
    }
    for (const child of report.children) {
      const age = child.ageInYears === null ? 'edad sin dato' : `${child.ageInYears} años`;
      line(`${child.firstName} ${child.lastName}`, `${age} · ${child.activityCount} actividad(es)`);
    }

    heading('Progenitores');
    if (report.members.length === 0) {
      doc.fillColor(MUTED).text('Sin miembros activos.');
    }
    for (const member of report.members) {
      line(
        `${member.firstName} ${member.lastName} (${member.role})`,
        `${member.completed}/${member.assigned} actividades · ${percent(member.completionPercentage)}`,
      );
    }

    doc.end();
  });
}
