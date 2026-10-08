import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';

import { ActivitiesService } from './activities.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { CancelActivityDto } from './dto/cancel-activity.dto';
import { DeclineActivityDto } from './dto/decline-activity.dto';
import { ComplianceResponseDto } from '../bonds/dto/compliance-response.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/dto/auth-user.dto';

@ApiTags('activities')
@Controller('activities')
@UseGuards(JwtAuthGuard)
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Post(':bondId/create')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create activity' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Body() dto: CreateActivityDto,
  ) {
    return this.activitiesService.create(bondId, dto, user.id);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm activity assignment (idempotent)' })
  confirmAssignment(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.activitiesService.confirmAssignment(id, user.id);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Decline activity assignment ("No asistir")',
    description:
      'R5/A1 · Motivo OBLIGATORIO de 3–200 caracteres (mismo validador que Cancelar). ' +
      'Errores: 404 no existe/no es miembro · 403 no es el asignado · 409 ACTIVITY_ALREADY_PAST · ' +
      '422 VALIDATION_FAILED. El 422 se lanza explícitamente, sin tocar el ValidationPipe global.',
  })
  declineAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: DeclineActivityDto,
  ) {
    return this.activitiesService.declineAssignment(id, user.id, dto?.reason);
  }

  // ── Acciones de swipe (R7) ───────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete activity ("Eliminar") — soft delete',
    description:
      'A4 · Escribe `deleted_at` y nada más: sin purga, sin retención y sin borrado en cascada. ' +
      'Se deshace con POST /:id/restore dentro de 5000 ms.',
  })
  deleteActivity(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.activitiesService.delete(id, user.id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Undo delete ("Deshacer") within the 5000 ms window',
    description:
      '409 ACTIVITY_UNDO_WINDOW_EXPIRED fuera de la ventana. La ventana la mide el reloj del servidor, ' +
      'así que si la app muere a mitad el borrado se sostiene.',
  })
  restoreActivity(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.activitiesService.restore(id, user.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel activity ("Cancelar") — creator only, reason required',
    description:
      'A1 · Motivo OBLIGATORIO de 3–200 caracteres. Sólo el creador. ' +
      '422 VALIDATION_FAILED si el motivo no cumple; 409 ACTIVITY_ALREADY_PAST si ya pasó.',
  })
  cancelActivity(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CancelActivityDto,
  ) {
    return this.activitiesService.cancel(id, user.id, dto?.reason);
  }

  @Post(':id/undo-decline')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Undo decline ("Deshacer No asistir") within the 5000 ms window',
    description:
      'Restaura el estado previo leyéndolo del audit. 409 ACTIVITY_UNDO_WINDOW_EXPIRED fuera de ventana.',
  })
  undoDecline(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.activitiesService.undoDecline(id, user.id);
  }

  @Get('bond/:bondId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List activities for a bond (ordered, summary shape)' })
  listByBond(@Param('bondId', ParseUUIDPipe) bondId: string, @CurrentUser() user: AuthUser) {
    return this.activitiesService.listByBond(bondId, user.id);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get activity detail by id' })
  getActivityDetail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.activitiesService.getDetail(id, user.id);
  }

  @Get(':bondId/compliance')
  @ApiOperation({ summary: 'Get bond compliance data' })
  async getBondCompliance(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const { bondActive, period, members } = await this.activitiesService.getComplianceForBond(
      bondId,
      user.id,
    );

    return plainToInstance(
      ComplianceResponseDto,
      {
        bondId,
        period,
        bondActive,
        members,
      },
      { excludeExtraneousValues: true },
    );
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark an activity as done (idempotent)' })
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.activitiesService.complete(id, user.id);
  }
}
