import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AuthUser } from '../../auth/dto/auth-user.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReplayService } from './replay.service';

/**
 * Replay de una entrega por id (REQ-LOG-2, AC-14, D9).
 *
 * Vive bajo `/api/webhooks/deliveries`: no lleva `bondId` en la ruta, así que el
 * servicio resuelve el bond vía entrega→suscripción y aplica la autorización de
 * membresía antes de re-encolar (reutiliza el `webhook-id`/`jobId` original).
 */
@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('webhooks/deliveries')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class WebhookDeliveryController {
  constructor(private readonly replayService: ReplayService) {}

  @Post(':id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Replay a single delivery reusing its original webhook-id' })
  replay(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.replayService.replayDelivery(id, user);
  }
}
