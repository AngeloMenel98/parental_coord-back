import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/dto/auth-user.dto';
import { BondsService } from './bonds.service';

@Controller('bonds')
@UseGuards(JwtAuthGuard)
export class BondsController {
  constructor(private readonly bondsService: BondsService) {}

  @Get()
  findMyBonds(@CurrentUser() user: AuthUser) {
    return this.bondsService.findByUserId(user.id);
  }
}
