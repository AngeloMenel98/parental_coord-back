import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuthService } from './auth.service';
import { UserEntity, SystemRole } from '../users/entities/user.entity';
import { PersonalDataEntity } from '../users/entities/personal-data.entity';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: jest.Mocked<Repository<UserEntity>>;
  let personalDataRepo: jest.Mocked<Repository<PersonalDataEntity>>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    userRepo = {
      findOneBy: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as any;

    personalDataRepo = {
      findOneBy: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as any;

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: getRepositoryToken(PersonalDataEntity), useValue: personalDataRepo },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user and return access token', async () => {
      userRepo.findOneBy.mockResolvedValue(null);
      userRepo.create.mockReturnValue({
        id: 'user-1',
        email: 'test@example.com',
        systemRole: SystemRole.USER,
        isActive: true,
      } as UserEntity);
      userRepo.save.mockResolvedValue({} as UserEntity);
      personalDataRepo.create.mockReturnValue({} as PersonalDataEntity);
      personalDataRepo.save.mockResolvedValue({} as PersonalDataEntity);
      personalDataRepo.findOneBy.mockResolvedValue({
        firstName: 'John',
        lastName: 'Doe',
      } as PersonalDataEntity);

      const result = await service.register({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
      });

      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user).not.toHaveProperty('password');
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('should throw BadRequestException for duplicate email', async () => {
      userRepo.findOneBy.mockResolvedValue({
        id: 'existing',
        email: 'test@example.com',
      } as UserEntity);

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'password123',
          firstName: 'John',
          lastName: 'Doe',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('login', () => {
    it('should return access token for valid credentials', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        passwordHash: '$2a$10$validhash',
        systemRole: SystemRole.USER,
        isActive: true,
      } as UserEntity;

      userRepo.findOneBy.mockResolvedValue(mockUser);
      personalDataRepo.findOneBy.mockResolvedValue(null);

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.user.email).toBe('test@example.com');
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      userRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.login({
          email: 'nonexistent@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
