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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SystemRole } from '../users/entities/user.entity';
import { AdminService } from './admin.service';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateBondDto } from './dto/create-bond.dto';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';
import { SetActiveDto } from './dto/set-active.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SystemRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Users ────────────────────────────────────────────────────────

  @Post('users')
  @ApiOperation({ summary: 'Create a progenitor account' })
  createUser(@Body() dto: CreateUserDto) {
    return this.adminService.createUser(dto);
  }

  @Get('users')
  @ApiOperation({ summary: 'List every account' })
  listUsers() {
    return this.adminService.listUsers();
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Activate or deactivate an account' })
  setUserActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto) {
    return this.adminService.setUserActive(id, dto.isActive);
  }

  // ── Bonds ────────────────────────────────────────────────────────

  @Post('bonds')
  @ApiOperation({ summary: 'Create a bond with exactly two members' })
  createBond(@Body() dto: CreateBondDto) {
    return this.adminService.createBond(dto);
  }

  @Get('bonds')
  @ApiOperation({ summary: 'List every bond with its members and children count' })
  listBonds() {
    return this.adminService.listBonds();
  }

  @Patch('bonds/:id')
  @ApiOperation({ summary: 'Activate or deactivate a bond' })
  setBondActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto) {
    return this.adminService.setBondActive(id, dto.isActive);
  }

  // ── Bond Members ─────────────────────────────────────────────────

  @Post('bonds/:id/members')
  @ApiOperation({ summary: 'Add a progenitor to an existing bond' })
  addBondMember(
    @Param('id', ParseUUIDPipe) bondId: string,
    @Body('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.adminService.addBondMember(bondId, userId);
  }

  // ── Children ─────────────────────────────────────────────────────

  @Get('bonds/:id/children')
  @ApiOperation({ summary: 'List the children of a bond' })
  listBondChildren(@Param('id', ParseUUIDPipe) bondId: string) {
    return this.adminService.listBondChildren(bondId);
  }

  @Post('bonds/:id/children')
  @ApiOperation({ summary: 'Create a child inside a bond' })
  addChildToBond(@Param('id', ParseUUIDPipe) bondId: string, @Body() dto: CreateChildDto) {
    return this.adminService.addChildToBond(bondId, dto);
  }

  @Patch('children/:id')
  @ApiOperation({ summary: 'Edit a child' })
  updateChild(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateChildDto) {
    return this.adminService.updateChild(id, dto);
  }

  @Delete('children/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a child' })
  removeChild(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.removeChild(id);
  }
}
