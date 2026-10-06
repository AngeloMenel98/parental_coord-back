import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';

import { UserEntity, SystemRole } from '../users/entities/user.entity';
import { PersonalDataEntity } from '../users/entities/personal-data.entity';
import { LoginDto, RegisterDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(PersonalDataEntity)
    private readonly personalDataRepo: Repository<PersonalDataEntity>,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.userRepo.findOneBy({ email: dto.email });
    if (existing) {
      throw new BadRequestException('Email already registered');
    }

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      email: dto.email,
      passwordHash: hashed,
      systemRole: SystemRole.USER,
      isActive: true,
    });
    await this.userRepo.save(user);

    const personalData = this.personalDataRepo.create({
      userId: user.id,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
    await this.personalDataRepo.save(personalData);

    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOneBy({ email: dto.email });
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

    const personal = await this.personalDataRepo.findOneBy({ userId: user.id });

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
