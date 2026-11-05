import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SystemRole } from '../users/entities/user.entity';
import { BondReportService } from './bond-report.service';
import { BondReportQueryDto } from './dto/bond-report-query.dto';

/**
 * B2 · vivo en el módulo de reportes, no en `admin.controller.ts`, para que el
 * reporte tenga su propia superficie. Las guardas son las mismas de `AdminController`:
 * `@Roles(SystemRole.ADMIN)` a nivel de clase, sin excepciones por ruta.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SystemRole.ADMIN)
export class AdminReportsController {
  constructor(private readonly reportsService: BondReportService) {}

  @Get('bonds/:bondId/report')
  @ApiOperation({ summary: 'Bond report for a date range (JSON)' })
  getBondReport(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Query() query: BondReportQueryDto,
  ) {
    return this.reportsService.build(bondId, {
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  }
}
