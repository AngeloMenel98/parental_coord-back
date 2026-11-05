import { percentage, round2 } from './build-bond-report';

/**
 * B4 · salud por vínculo y tendencia de cumplimiento.
 *
 * El artboard `admin-ui/01` muestra, en la lista, tres datos por vínculo
 * (hijos, % cumplido, % pagado) y, en el detalle, la serie de seis meses. Pedir
 * un reporte por vínculo y por mes serían decenas de requests: estas dos
 * funciones puras convierten cuatro agregados agrupados en lo que la pantalla
 * necesita.
 */

export interface BondHealthAggregates {
  activitiesTotal: number;
  activitiesCompleted: number;
  expensesEligibleAmount: number;
  expensesPaidAmount: number;
  childrenCount: number;
  membersCount: number;
}

export interface BondHealthRow {
  bondId: string;
  title: string;
  agreementType: string;
  isActive: boolean;
  membersCount: number;
  childrenCount: number;
  activitiesTotal: number;
  completionRate: number;
  paidAmountPercentage: number;
}

const EMPTY_AGGREGATES: BondHealthAggregates = {
  activitiesTotal: 0,
  activitiesCompleted: 0,
  expensesEligibleAmount: 0,
  expensesPaidAmount: 0,
  childrenCount: 0,
  membersCount: 0,
};

export function buildBondHealthRow(
  bond: { id: string; title: string; agreementType: string; isActive: boolean },
  aggregates: BondHealthAggregates = EMPTY_AGGREGATES,
): BondHealthRow {
  return {
    bondId: bond.id,
    title: bond.title,
    agreementType: bond.agreementType,
    isActive: bond.isActive,
    membersCount: aggregates.membersCount,
    childrenCount: aggregates.childrenCount,
    activitiesTotal: aggregates.activitiesTotal,
    completionRate: percentage(aggregates.activitiesCompleted, aggregates.activitiesTotal),
    paidAmountPercentage: percentage(
      aggregates.expensesPaidAmount,
      aggregates.expensesEligibleAmount,
    ),
  };
}

export interface BondTrendAggregateRow {
  /** `YYYY-MM`. */
  month: string;
  activitiesTotal: number;
  activitiesCompleted: number;
}

export interface BondTrendPoint {
  month: string;
  activitiesTotal: number;
  completionRate: number;
}

/** `YYYY-MM` del instante, en UTC — la misma zona que usa la ventana del reporte. */
export function monthKey(date: Date): string {
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
}

/**
 * Serie completa de `months` meses terminando en el mes de `reference`.
 *
 * Los meses sin actividades se devuelven con `completionRate: 0` en vez de
 * omitirse: un hueco en la serie se lee como "sin datos", que es justo lo que no
 * se puede distinguir si el punto falta.
 */
export function buildBondTrend(
  rows: BondTrendAggregateRow[],
  months: number,
  reference: Date,
): BondTrendPoint[] {
  const byMonth = new Map(rows.map((row) => [row.month, row]));

  const series: BondTrendPoint[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(
      Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - offset, 1),
    );
    const key = monthKey(cursor);
    const row = byMonth.get(key);
    series.push({
      month: key,
      activitiesTotal: row?.activitiesTotal ?? 0,
      completionRate: percentage(row?.activitiesCompleted ?? 0, row?.activitiesTotal ?? 0),
    });
  }

  return series;
}

/** El total pagado nunca puede superar el elegible; si pasa, el dato está mal. */
export function clampPaidPercentage(value: number): number {
  return Math.min(100, round2(value));
}
