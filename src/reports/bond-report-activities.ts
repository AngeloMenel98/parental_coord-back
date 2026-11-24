import { ActivityStatus } from '../activities/entities/activity.entity';

/**
 * B6 · S16 — armado del listado de actividades del reporte (drill-down).
 *
 * Función pura a propósito: el repositorio reutiliza la query de la ventana del
 * S6 (`BondReportRepository.findActivities`) y esto ordena, capa, resuelve
 * nombres y formatea. No se redefine "actividad del período": es la misma.
 */

/** S16: el listado se capea a 200 filas; `total` cuenta todas las de la ventana. */
export const BOND_ACTIVITIES_MAX_ROWS = 200;

export interface BondActivityRow {
  id: string;
  title: string;
  status: ActivityStatus;
  categoryId: string | null;
  assignedTo: string | null;
  scheduledStart: Date | null;
  /** Forma parte de la fecha de referencia: `COALESCE(scheduled_start, created_at)`. */
  createdAt: Date;
  deadline: Date | null;
  completedAt: Date | null;
}

export interface BondActivityCategoryRow {
  id: string;
  name: string;
}

export interface BondActivityMemberRow {
  userId: string;
  firstName: string;
  lastName: string;
}

export interface BondActivitiesInput {
  bondId: string;
  dateFrom: string;
  dateTo: string;
  rows: BondActivityRow[];
  categories: BondActivityCategoryRow[];
  members: BondActivityMemberRow[];
}

export interface BondActivityItem {
  id: string;
  title: string;
  status: ActivityStatus;
  categoryId: string | null;
  categoryName: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  scheduledStart: string | null;
  deadline: string | null;
  completedAt: string | null;
}

export interface BondActivitiesReport {
  bondId: string;
  dateFrom: string;
  dateTo: string;
  total: number;
  activities: BondActivityItem[];
}

/** S16: fecha de referencia — la agendada si existe, la de creación si no. */
const referenceTime = (row: BondActivityRow): number =>
  (row.scheduledStart ?? row.createdAt).getTime();

/** Orden por fecha de referencia descendente y, a igualdad, `id` ascendente. */
const compareByReference = (a: BondActivityRow, b: BondActivityRow): number => {
  const diff = referenceTime(b) - referenceTime(a);
  if (diff !== 0) return diff;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
};

const toIso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** `"<firstName> <lastName>"` sin espacio sobrante; sin nombres, `null`. */
const fullName = (firstName: string, lastName: string): string | null => {
  const name = `${firstName} ${lastName}`.trim();
  return name.length > 0 ? name : null;
};

export function buildBondActivities(input: BondActivitiesInput): BondActivitiesReport {
  const categoryNames = new Map(input.categories.map((category) => [category.id, category.name]));
  const memberNames = new Map(
    input.members.map((member) => [
      member.userId,
      fullName(member.firstName ?? '', member.lastName ?? ''),
    ]),
  );

  const ordered = [...input.rows].sort(compareByReference);

  return {
    bondId: input.bondId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    total: ordered.length,
    activities: ordered.slice(0, BOND_ACTIVITIES_MAX_ROWS).map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      categoryId: row.categoryId,
      // Una categoría o un miembro que ya no está no rompe la respuesta: `null`.
      categoryName: row.categoryId ? (categoryNames.get(row.categoryId) ?? null) : null,
      assignedTo: row.assignedTo,
      assigneeName: row.assignedTo ? (memberNames.get(row.assignedTo) ?? null) : null,
      scheduledStart: toIso(row.scheduledStart),
      deadline: toIso(row.deadline),
      completedAt: toIso(row.completedAt),
    })),
  };
}
