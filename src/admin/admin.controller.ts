import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SystemRole } from '../users/entities/user.entity';
import { AdminService } from './admin.service';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateBondDto } from './dto/create-bond.dto';
import { CreateChildDto } from './dto/create-child.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SystemRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Users ────────────────────────────────────────────────────────

  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.adminService.createUser(dto);
  }

  @Get('users')
  listUsers() {
    return this.adminService.listUsers();
  }

  // ── Bonds ────────────────────────────────────────────────────────

  @Post('bonds')
  createBond(@Body() dto: CreateBondDto) {
    return this.adminService.createBond(dto);
  }

  @Get('bonds')
  listBonds() {
    return this.adminService.listBonds();
  }

  // ── Bond Members ─────────────────────────────────────────────────

  @Post('bonds/:id/members')
  addBondMember(
    @Param('id', ParseUUIDPipe) bondId: string,
    @Body('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.adminService.addBondMember(bondId, userId);
  }

  // ── Children ─────────────────────────────────────────────────────

  @Get('bonds/:id/children')
  listBondChildren(@Param('id', ParseUUIDPipe) bondId: string) {
    return this.adminService.listBondChildren(bondId);
  }

  @Post('bonds/:id/children')
  addChildToBond(
    @Param('id', ParseUUIDPipe) bondId: string,
    @Body() dto: CreateChildDto,
  ) {
    return this.adminService.addChildToBond(bondId, dto);
  }
}
