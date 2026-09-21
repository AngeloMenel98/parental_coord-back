import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ChildrenService } from './children.service';
import { CreateChildDto } from './dto/create-child.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/dto/auth-user.dto';

@ApiTags('children')
@Controller('bonds/:bondId/children')
export class ChildrenController {
  constructor(private readonly childrenService: ChildrenService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create child' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Body() dto: CreateChildDto,
  ) {
    return this.childrenService.create(bondId, dto, user.id);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List children' })
  findByBond(
    @CurrentUser() user: AuthUser,
    @Param('bondId', ParseUUIDPipe) bondId: string,
  ) {
    return this.childrenService.findByBond(bondId, user.id);
  }
}
