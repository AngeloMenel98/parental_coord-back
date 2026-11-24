import { ActivityStatus } from '../activities/entities/activity.entity';

import {
  BOND_ACTIVITIES_MAX_ROWS,
  BondActivitiesInput,
  BondActivityRow,
  buildBondActivities,
} from './bond-report-activities';

/**
 * B6 · S16 — armado del listado de actividades del reporte.
 *
 * Función pura: el repositorio trae las filas de la ventana del S6, esto ordena,
 * capa, resuelve nombres y formatea. Sin esto las reglas (orden por fecha de
 * referencia, tope de 200 con `total` completo, nombres que no rompen la
 * respuesta) sólo se podrían probar levantando Postgres.
 */
describe('buildBondActivities (B6)', () => {
  const row = (overrides: Partial<BondActivityRow> = {}): BondActivityRow => ({
    id: 'act-1',
    title: 'Actividad',
    status: ActivityStatus.ASSIGNED,
    categoryId: null,
    assignedTo: null,
    scheduledStart: null,
    createdAt: new Date('2026-06-10T00:00:00.000Z'),
    deadline: null,
    completedAt: null,
    ...overrides,
  });

  const input = (overrides: Partial<BondActivitiesInput> = {}): BondActivitiesInput => ({
    bondId: 'bond-1',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-30',
    rows: [],
    categories: [],
    members: [],
    ...overrides,
  });

  it('orders by the reference date descending, then id ascending', () => {
    const report = buildBondActivities(
      input({
        rows: [
          row({ id: 'b', scheduledStart: new Date('2026-06-05T08:00:00.000Z') }),
          row({ id: 'a', createdAt: new Date('2026-06-20T08:00:00.000Z') }),
          row({ id: 'c', createdAt: new Date('2026-06-20T08:00:00.000Z') }),
          row({ id: 'd', createdAt: new Date('2026-06-01T08:00:00.000Z') }),
        ],
      }),
    );

    expect(report.activities.map((activity) => activity.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('counts every row in the window while the array stops at 200', () => {
    const rows = Array.from({ length: 205 }, (_, index) =>
      row({
        id: `act-${String(index).padStart(3, '0')}`,
        createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0, index)),
      }),
    );

    const report = buildBondActivities(input({ rows }));

    expect(report.total).toBe(205);
    expect(report.activities).toHaveLength(BOND_ACTIVITIES_MAX_ROWS);
    expect(BOND_ACTIVITIES_MAX_ROWS).toBe(200);
    // El tope se aplica después de ordenar: sobreviven las 200 más recientes.
    expect(report.activities[0].id).toBe('act-204');
    expect(report.activities[199].id).toBe('act-005');
  });

  it('resolves category names and leaves an unknown category null', () => {
    const report = buildBondActivities(
      input({
        rows: [row({ id: 'a', categoryId: 'cat-1' }), row({ id: 'b', categoryId: 'cat-9' })],
        categories: [{ id: 'cat-1', name: 'Escuela' }],
      }),
    );

    expect(report.activities[0]).toMatchObject({
      id: 'a',
      categoryId: 'cat-1',
      categoryName: 'Escuela',
    });
    expect(report.activities[1]).toMatchObject({
      id: 'b',
      categoryId: 'cat-9',
      categoryName: null,
    });
  });

  it('resolves assignee names from the bond members and leaves unknown ones null', () => {
    const report = buildBondActivities(
      input({
        rows: [
          row({ id: 'a', assignedTo: 'user-1' }),
          row({ id: 'b', assignedTo: 'user-9' }),
          row({ id: 'c', assignedTo: null }),
        ],
        members: [{ userId: 'user-1', firstName: 'Ana', lastName: 'Paz' }],
      }),
    );

    expect(report.activities[0].assigneeName).toBe('Ana Paz');
    expect(report.activities[1].assigneeName).toBeNull();
    expect(report.activities[2].assignedTo).toBeNull();
    expect(report.activities[2].assigneeName).toBeNull();
  });

  it('trims the joined assignee name when a member has no last name', () => {
    const report = buildBondActivities(
      input({
        rows: [row({ id: 'a', assignedTo: 'user-1' })],
        members: [{ userId: 'user-1', firstName: 'Ana', lastName: '' }],
      }),
    );

    expect(report.activities[0].assigneeName).toBe('Ana');
  });

  it('returns ISO dates and keeps null when the timestamp is absent', () => {
    const report = buildBondActivities(
      input({
        bondId: 'bond-1',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
        rows: [
          row({
            id: 'a',
            title: 'Cita médica',
            status: ActivityStatus.DONE,
            scheduledStart: new Date('2026-06-03T09:30:00.000Z'),
            deadline: new Date('2026-06-04T23:59:59.999Z'),
            completedAt: new Date('2026-06-03T10:00:00.000Z'),
          }),
        ],
      }),
    );

    expect(report).toEqual({
      bondId: 'bond-1',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
      total: 1,
      activities: [
        {
          id: 'a',
          title: 'Cita médica',
          status: ActivityStatus.DONE,
          categoryId: null,
          categoryName: null,
          assignedTo: null,
          assigneeName: null,
          scheduledStart: '2026-06-03T09:30:00.000Z',
          deadline: '2026-06-04T23:59:59.999Z',
          completedAt: '2026-06-03T10:00:00.000Z',
        },
      ],
    });
  });
});
