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

import { AuthUser } from '../auth/dto/auth-user.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateThirdPartyDto } from './dto/create-third-party.dto';
import { ThirdPartyResponseDto } from './dto/third-party-response.dto';
import { UpdateThirdPartyDto } from './dto/update-third-party.dto';
import { ThirdPartiesService } from './third-parties.service';

/**
 * Rutas del acceso temporal (T2). Ninguna es pública: todas exigen JWT y todas vuelven
 * a resolver la tenencia en el servicio, porque el token no autoriza nada (el `sub` es
 * una pista de enrutado, no un permiso).
 *
 * El prefijo global `/api` lo pone `app.setup.ts`; acá van las rutas tal cual las
 * consume el front (`GET /third-parties/me`).
 */
@ApiTags('third-parties')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class ThirdPartiesController {
  constructor(private readonly thirdParties: ThirdPartiesService) {}

  @Get('bonds/:bondId/third-parties')
  @ApiOperation({ summary: 'Accesos temporales que otorgó el progenitor autenticado' })
  list(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ThirdPartyResponseDto[]> {
    return this.thirdParties.listForOwner(bondId, user.id);
  }

  @Post('bonds/:bondId/third-parties')
  @ApiOperation({
    summary: 'Otorgar acceso temporal a una cuenta existente (el alta de credenciales está diferida, D4)',
  })
  create(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateThirdPartyDto,
  ): Promise<ThirdPartyResponseDto> {
    return this.thirdParties.createForOwner(bondId, user.id, dto);
  }

  @Patch('third-parties/:id')
  @ApiOperation({ summary: 'Cambiar vencimiento, relación o nota de un acceso vigente' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateThirdPartyDto,
  ): Promise<ThirdPartyResponseDto> {
    return this.thirdParties.updateForOwner(id, user.id, dto);
  }

  @Delete('third-parties/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revocar el acceso de inmediato (idempotente)' })
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ThirdPartyResponseDto> {
    return this.thirdParties.revokeForOwner(id, user.id);
  }

  @Get('third-parties/me')
  @ApiOperation({ summary: 'Mi acceso temporal: quién me autorizó y hasta cuándo' })
  me(@CurrentUser() user: AuthUser): Promise<ThirdPartyResponseDto> {
    return this.thirdParties.getMyGrant(user.id);
  }
}
