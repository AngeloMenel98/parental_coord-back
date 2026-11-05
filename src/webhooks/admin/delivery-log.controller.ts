import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AuthUser } from '../../auth/dto/auth-user.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReplayService } from './replay.service';
import { DeliveryLogService } from './delivery-log.service';
import { WebhookDeliveryLogQueryDto } from './dto/webhook-delivery-log.dto';

/**
 * Log de entregas + replay masivo de muertas (REQ-LOG-1/2, AC-16, D9).
 *
 * Comparte el prefijo `/api/bonds/:bondId/webhooks` con `SubscriptionsController`;
 * las rutas completas no colisionan (`subscriptions/:id/deliveries` vs
 * `subscriptions/:id/replay-dead`). Lectura abierta a miembros activos; el
 * replay-dead es una mutación y exige membresía activa o admin.
 */
@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('bonds/:bondId/webhooks')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class WebhookDeliveryLogController {
  constructor(
    private readonly deliveryLog: DeliveryLogService,
    private readonly replay: ReplayService,
  ) {}

  @Get('subscriptions/:id/deliveries')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Paginated delivery log of a subscription (with attempts)' })
  getDeliveries(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: WebhookDeliveryLogQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.deliveryLog.getLog(bondId, id, query, user);
  }

  @Post('subscriptions/:id/replay-dead')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Replay every DEAD delivery of a subscription' })
  replayDead(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.replay.replayDead(bondId, id, user);
  }
}
