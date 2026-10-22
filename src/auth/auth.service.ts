import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { UserEntity, SystemRole } from '../users/entities/user.entity';
import { UsersRepository } from '../users/repositories/users.repository';
import { PersonalDataRepository } from '../users/repositories/personal-data.repository';
import { LoginDto, RegisterDto } from './dto/auth.dto';

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

  private async buildAuthResponse(user: UserEntity) {
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
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
      },
    };
  }
}
