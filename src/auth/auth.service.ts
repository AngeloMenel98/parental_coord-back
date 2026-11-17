import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { UserEntity, SystemRole } from '../users/entities/user.entity';
import { UsersRepository } from '../users/repositories/users.repository';
import { PersonalDataRepository } from '../users/repositories/personal-data.repository';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly personalDataRepo: PersonalDataRepository,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersRepo.findOneByEmail(dto.email);
    if (existing) {
      throw new BadRequestException('Email already registered');
    }

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.usersRepo.createAndSave({
      email: dto.email,
      passwordHash: hashed,
      systemRole: SystemRole.USER,
      isActive: true,
      // D3: acá la persona eligió su propia contraseña, así que no se la obliga a cambiarla.
      mustChangePassword: false,
    });

    await this.personalDataRepo.createAndSave({
      userId: user.id,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersRepo.findOneByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.buildAuthResponse(user);
  }

  /**
   * S2 · cambio de contraseña del usuario autenticado (`POST /auth/change-password`).
   *
   * Limpia `must_change_password` y devuelve un `access_token` NUEVO con la MISMA forma
   * que el login. Devolver el token viejo no serviría: sigue diciendo
   * `mustChangePassword: true` y el guard cerraría la primera pantalla que abriera.
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.usersRepo.findById(userId);
    if (!user) {
      // El token es válido pero la cuenta ya no existe: mismo 401 que el login.
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('The new password must be different from the current one');
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    user.mustChangePassword = false;
    const saved = await this.usersRepo.save(user);

    return this.buildAuthResponse(saved);
  }

  private async buildAuthResponse(user: UserEntity) {
    // D3: sólo una fila marcada obliga al cambio; una columna ausente (o `null`) vale
    // `false`, así un token viejo o un mock sin el campo no bloquean a nadie.
    const mustChangePassword = user.mustChangePassword === true;

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
      // La claim viaja en el token: el guard la lee sin pegarle a la DB en cada request.
      mustChangePassword,
    });

    const personal = await this.personalDataRepo.findOneByUserId(user.id);

    return {
      access_token: token,
      user: {
        id: user.id,
        email: user.email,
        systemRole: user.systemRole,
        firstName: personal?.firstName ?? null,
        lastName: personal?.lastName ?? null,
        mustChangePassword,
      },
    };
  }
}
