import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { Clock } from '../common/clock/clock';
import { addDaysToIsoDate } from './bond-report.service';
import {
  BondHealthRow,
  BondTrendPoint,
  buildBondHealthRow,
  buildBondTrend,
} from './build-bond-health';
import { BondHealthRepository } from './repositories/bond-health.repository';

export interface BondPeriod {
  dateFrom: string;
  dateTo: string;
}

const DEFAULT_TREND_MONTHS = 6;

/**
 * B4 · lo que la lista de vínculos y su detalle necesitan, en dos llamadas.
 *
 * `health` devuelve una fila por vínculo con los tres datos de la tarjeta;
 * `trend` devuelve la serie mensual del detalle. Ambos usan la misma ventana
 * inclusiva→exclusiva en UTC que el reporte, para que la tarjeta, la tendencia y
 * el PDF no puedan contar períodos distintos.
 */
@Injectable()
export class BondHealthService {
  constructor(
    private readonly repo: BondHealthRepository,
    private readonly clock: Clock,
  ) {}

  async health(period: BondPeriod): Promise<BondHealthRow[]> {
    const { from, to } = this.window(period.dateFrom, period.dateTo);

    const bonds = await this.repo.findBonds();
    const aggregates = await this.repo.aggregatesByBond(
      bonds.map((bond) => bond.id),
      from,
      to,
    );

    return bonds.map((bond) => buildBondHealthRow(bond, aggregates.get(bond.id)));
  }

  async trend(
    bondId: string,
    months: number = DEFAULT_TREND_MONTHS,
  ): Promise<{ bondId: string; months: BondTrendPoint[] }> {
    if (months < 1 || months > 12) {
      throw new BadRequestException('months must be between 1 and 12');
    }

    const bond = await this.repo.bondExists(bondId);
    if (!bond) throw new NotFoundException(`Bond ${bondId} not found`);

    const now = this.clock.now();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const toExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const rows = await this.repo.trendByMonth(bondId, from, toExclusive);

    return { bondId, months: buildBondTrend(rows, months, now) };
  }

  /** Ventana inclusiva del usuario → `>= from`, `< to + 1 día`, en UTC. */
  private window(dateFrom: string, dateTo: string): { from: Date; to: Date } {
    if (dateTo < dateFrom) {
      throw new BadRequestException('dateTo must be on or after dateFrom');
    }
    return {
      from: new Date(`${dateFrom}T00:00:00.000Z`),
      to: new Date(`${addDaysToIsoDate(dateTo, 1)}T00:00:00.000Z`),
    };
  }
}
