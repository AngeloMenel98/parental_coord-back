import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
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
import { plainToInstance } from 'class-transformer';

import { ActivitiesService } from './activities.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { ComplianceResponseDto } from '../bonds/dto/compliance-response.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/dto/auth-user.dto';
import { BondsRepository } from '../bonds/repositories/bonds.repository';

@ApiTags('activities')
@Controller('activities')
@UseGuards(JwtAuthGuard)
export class ActivitiesController {
  constructor(
    private readonly activitiesService: ActivitiesService,
    private readonly bondsRepo: BondsRepository,
  ) {}

  @Post(':bondId/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create activity' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Body() dto: CreateActivityDto,
  ) {
    return this.activitiesService.create(bondId, dto, user.id);
  }

  @Get(':bondId/compliance')
  @ApiOperation({ summary: 'Get bond compliance data' })
  async getBondCompliance(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const bond = await this.bondsRepo.findActiveBondForMember(bondId, user.id);

    if (!bond) {
      throw new NotFoundException('Bond not found or you are not a member');
    }

    const members = await this.activitiesService.getComplianceForBond(bondId);

    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return plainToInstance(
      ComplianceResponseDto,
      {
        bondId,
        period,
        bondActive: bond.isActive,
        members,
      },
      { excludeExtraneousValues: true },
    );
  }
}
