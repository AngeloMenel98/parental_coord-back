import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AuthUser } from '../../auth/dto/auth-user.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { listEventCatalog } from '../events/event-catalog';
import { CreateWebhookSubscriptionDto } from './dto/create-webhook-subscription.dto';
import { UpdateWebhookSubscriptionDto } from './dto/update-webhook-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

/**
 * API de gestión de suscripciones (REQ-SUB-1..6, AC-1, D8).
 *
 * Prefijo global `api` ⇒ efectivo `/api/bonds/:bondId/webhooks`. Todo el
 * controlador va tras `JwtAuthGuard`; la autorización por membresía la aplica el
 * servicio con el seam `WebhookAuthzService` (403 si no es miembro activo).
 * `@Throttle` añade el límite por ruta sobre el throttler global (REQ-SEC-5).
 */
@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('bonds/:bondId/webhooks')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post('subscriptions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a webhook subscription (secret shown once)' })
  create(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Body() dto: CreateWebhookSubscriptionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.subscriptions.create(bondId, dto, user);
  }

  @Get('subscriptions')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'List webhook subscriptions of a bond' })
  list(@Param('bondId', ParseUUIDPipe) bondId: string, @CurrentUser() user: AuthUser) {
    return this.subscriptions.list(bondId, user);
  }

  @Get('subscriptions/:id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get a webhook subscription (no secret)' })
  get(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.subscriptions.get(bondId, id, user);
  }

  @Patch('subscriptions/:id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Update a webhook subscription (url/eventTypes/description/status)' })
  update(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookSubscriptionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.subscriptions.update(bondId, id, dto, user);
  }

  @Delete('subscriptions/:id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a webhook subscription' })
  remove(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.subscriptions.remove(bondId, id, user);
  }

  @Post('subscriptions/:id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate the signing secret (previous stays valid during grace)' })
  rotateSecret(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.subscriptions.rotateSecret(bondId, id, user);
  }

  @Post('subscriptions/:id/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Enqueue a webhook.test ping to the endpoint' })
  test(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.subscriptions.test(bondId, id, user);
  }

  @Get('event-types')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'List the advertised webhook event catalog' })
  eventTypes() {
    return listEventCatalog();
  }
}
