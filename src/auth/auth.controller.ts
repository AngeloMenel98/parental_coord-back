import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AllowDuringPasswordChange } from '../common/decorators/allow-during-password-change.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from './dto/auth-user.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Register a new progenitor user' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Login and obtain a JWT access token' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  // S2: con `mustChangePassword` activo es una de las dos rutas que siguen abiertas.
  @AllowDuringPasswordChange()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated user profile' })
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @AllowDuringPasswordChange()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cambiar la contraseña y recibir un token nuevo (obligatorio en el primer ingreso)',
  })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto);
  }
}
