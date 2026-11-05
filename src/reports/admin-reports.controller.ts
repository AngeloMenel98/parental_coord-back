import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthUser } from '../auth/dto/auth-user.dto';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SystemRole } from '../users/entities/user.entity';
import { BondReportService } from './bond-report.service';
import { BondReportQueryDto } from './dto/bond-report-query.dto';
import { CreateReportRequestDto } from './dto/create-report-request.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ReportsService } from './reports.service';

/**
 * B2/B3 · vivo en el módulo de reportes, no en `admin.controller.ts`, para que el
 * reporte tenga su propia superficie. Las guardas son las mismas de `AdminController`:
 * `@Roles(SystemRole.ADMIN)` a nivel de clase, sin excepciones por ruta.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SystemRole.ADMIN)
export class AdminReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly bondReportService: BondReportService,
  ) {}

  @Get('bonds/:bondId/report')
  @ApiOperation({ summary: 'Bond report for a date range (JSON)' })
  getBondReport(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Query() query: BondReportQueryDto,
  ) {
    return this.bondReportService.build(bondId, {
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  }

  @Post('bonds/:bondId/reports')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue the PDF version of a bond report' })
  requestReport(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Body() dto: CreateReportRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.requestPdf(
      bondId,
      { dateFrom: dto.dateFrom, dateTo: dto.dateTo },
      user.id,
    );
  }

  @Get('reports')
  @ApiOperation({ summary: 'List generated reports, newest first' })
  listReports(@Query() query: ListReportsQueryDto) {
    return this.reportsService.listReports(query.bondId);
  }

  @Get('reports/:id')
  @ApiOperation({ summary: 'Status of one report, with a signed download URL when ready' })
  getReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.reportsService.getReport(id);
  }
}
