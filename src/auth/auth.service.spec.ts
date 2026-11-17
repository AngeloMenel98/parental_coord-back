import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AuthService } from './auth.service';
import { UserEntity, SystemRole } from '../users/entities/user.entity';
import { PersonalDataEntity } from '../users/entities/personal-data.entity';
import { UsersRepository } from '../users/repositories/users.repository';
import { PersonalDataRepository } from '../users/repositories/personal-data.repository';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: jest.Mocked<UsersRepository>;
  let personalDataRepo: jest.Mocked<PersonalDataRepository>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    userRepo = {
      findOneByEmail: jest.fn(),
      findById: jest.fn(),
      createAndSave: jest.fn(),
      save: jest.fn(),
    } as any;

    personalDataRepo = {
      findOneByUserId: jest.fn(),
      createAndSave: jest.fn(),
    } as any;

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersRepository, useValue: userRepo },
        { provide: PersonalDataRepository, useValue: personalDataRepo },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /** S2: la claim tiene que viajar en el token, no sólo en la respuesta HTTP. */
  const signedPayload = (): Record<string, unknown> =>
    (jwtService.sign as jest.Mock).mock.calls.at(-1)?.[0] as Record<string, unknown>;

  describe('register', () => {
    it('should register a new user and return access token', async () => {
      userRepo.findOneByEmail.mockResolvedValue(null);
      userRepo.createAndSave.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        systemRole: SystemRole.USER,
        isActive: true,
      } as UserEntity);
      personalDataRepo.createAndSave.mockResolvedValue({} as PersonalDataEntity);
      personalDataRepo.findOneByUserId.mockResolvedValue({
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
      // D3: quien elige su propia contraseña al registrarse no queda obligado a cambiarla.
      expect(result.user.mustChangePassword).toBe(false);
      expect(signedPayload()).toMatchObject({ sub: 'user-1', mustChangePassword: false });
    });

    it('should throw BadRequestException for duplicate email', async () => {
      userRepo.findOneByEmail.mockResolvedValue({
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

      userRepo.findOneByEmail.mockResolvedValue(mockUser);
      personalDataRepo.findOneByUserId.mockResolvedValue(null);

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.user.email).toBe('test@example.com');
      // Una cuenta con contraseña generada por el sistema entra marcada en el token.
      expect(result.user.mustChangePassword).toBe(false);
    });

    it('carries mustChangePassword=true in the payload and in the user (S2)', async () => {
      const mockUser = {
        id: 'user-2',
        email: 'abuela@example.com',
        passwordHash: '$2a$10$generated',
        systemRole: SystemRole.USER,
        isActive: true,
        mustChangePassword: true,
      } as UserEntity;

      userRepo.findOneByEmail.mockResolvedValue(mockUser);
      personalDataRepo.findOneByUserId.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        email: 'abuela@example.com',
        password: 'temporal-123',
      });

      expect(result.user.mustChangePassword).toBe(true);
      expect(signedPayload()).toMatchObject({ sub: 'user-2', mustChangePassword: true });
    });

    it('un token de una fila sin la columna vale como false (backward compatible)', async () => {
      const mockUser = {
        id: 'user-3',
        email: 'viejo@example.com',
        passwordHash: '$2a$10$validhash',
        systemRole: SystemRole.USER,
        isActive: true,
      } as UserEntity;

      userRepo.findOneByEmail.mockResolvedValue(mockUser);
      personalDataRepo.findOneByUserId.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({ email: 'viejo@example.com', password: 'x' });

      expect(result.user.mustChangePassword).toBe(false);
      expect(signedPayload()).toMatchObject({ mustChangePassword: false });
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      userRepo.findOneByEmail.mockResolvedValue(null);

      await expect(
        service.login({
          email: 'nonexistent@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  /**
   * S2 · `POST /auth/change-password`.
   *
   * El cambio no es cosmético: limpia el flag y devuelve un token NUEVO con la misma
   * forma que el login. Si devolviera el viejo, ése seguiría diciendo
   * `mustChangePassword: true` y el guard cerraría la primera pantalla que abriera.
   */
  describe('changePassword', () => {
    const storedUser = (overrides: Partial<UserEntity> = {}) =>
      ({
        id: 'user-pw',
        email: 'abuela@example.com',
        passwordHash: '$2a$10$temporal',
        systemRole: SystemRole.USER,
        isActive: true,
        mustChangePassword: true,
        ...overrides,
      }) as UserEntity;

    it('clears the flag, stores the hash and returns a fresh token (S2)', async () => {
      const user = storedUser();
      userRepo.findById.mockResolvedValue(user);
      userRepo.save.mockImplementation(async (row) => row as UserEntity);
      personalDataRepo.findOneByUserId.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.changePassword(user.id, {
        currentPassword: 'temporal-123',
        newPassword: 'nuevaClave1',
      });

      expect(bcrypt.compare).toHaveBeenCalledWith('temporal-123', '$2a$10$temporal');
      expect(bcrypt.hash).toHaveBeenCalledWith('nuevaClave1', 10);
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'user-pw',
          passwordHash: '$2a$10$hashedpassword',
          mustChangePassword: false,
        }),
      );
      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.user.mustChangePassword).toBe(false);
      expect(signedPayload()).toMatchObject({ sub: 'user-pw', mustChangePassword: false });
    });

    it('rejects a wrong current password with 401 and writes nothing', async () => {
      userRepo.findById.mockResolvedValue(storedUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-pw', {
          currentPassword: 'no-es-esta',
          newPassword: 'nuevaClave1',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(userRepo.save).not.toHaveBeenCalled();
      expect(bcrypt.hash).not.toHaveBeenCalled();
    });

    it('rejects a new password equal to the current one with 400', async () => {
      userRepo.findById.mockResolvedValue(storedUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.changePassword('user-pw', {
          currentPassword: 'temporal-123',
          newPassword: 'temporal-123',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(userRepo.save).not.toHaveBeenCalled();
    });
  });
});
