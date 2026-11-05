import { NotFoundException, ValidationPipe } from '@nestjs/common';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SystemRole } from '../users/entities/user.entity';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CreateChildDto as AdminCreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

/**
 * B1 · Gestión del admin más allá de la creación.
 *
 * Lo mockeado es sólo la persistencia: cada caso afirma el efecto observable
 * (valor devuelto, mutación pedida al repositorio, excepción con su mensaje).
 */
describe('AdminService (B1)', () => {
  const USER = 'user-1';
  const BOND = 'bond-1';
  const CHILD = 'child-1';

  let service: AdminService;
  let usersRepo: {
    findOneByWhere: jest.Mock;
    findAllWithPersonalData: jest.Mock;
    findByIds: jest.Mock;
    findById: jest.Mock;
    createAndSave: jest.Mock;
    save: jest.Mock;
  };
  let personalDataRepo: { createAndSave: jest.Mock };
  let bondsRepo: {
    findById: jest.Mock;
    findBondEnriched: jest.Mock;
    createAndSave: jest.Mock;
    save: jest.Mock;
    findAllBondsEnriched: jest.Mock;
  };
  let bondMembersRepo: {
    createAndSaveMany: jest.Mock;
    createAndSave: jest.Mock;
    findOneByBondAndUser: jest.Mock;
  };
  let childrenRepo: {
    findById: jest.Mock;
    findByBond: jest.Mock;
    createAndSave: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    updateEntity: jest.Mock;
    removeEntity: jest.Mock;
  };

  beforeEach(() => {
    usersRepo = {
      findOneByWhere: jest.fn(),
      findAllWithPersonalData: jest.fn(),
      findByIds: jest.fn(),
      findById: jest.fn(),
      createAndSave: jest.fn(),
      save: jest.fn(),
    };
    personalDataRepo = { createAndSave: jest.fn() };
    bondsRepo = {
      findById: jest.fn(),
      findBondEnriched: jest.fn(),
      createAndSave: jest.fn(),
      save: jest.fn(),
      findAllBondsEnriched: jest.fn(),
    };
    bondMembersRepo = {
      createAndSaveMany: jest.fn(),
      createAndSave: jest.fn(),
      findOneByBondAndUser: jest.fn(),
    };
    childrenRepo = {
      findById: jest.fn(),
      findByBond: jest.fn(),
      createAndSave: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      updateEntity: jest.fn(),
      removeEntity: jest.fn(),
    };

    service = new AdminService(
      usersRepo as never,
      personalDataRepo as never,
      bondsRepo as never,
      bondMembersRepo as never,
      childrenRepo as never,
    );
  });

  // ── S1 · Activar/desactivar usuario ─────────────────────────────

  it('S1 deactivates a user and returns the same shape the users list returns', async () => {
    usersRepo.findById.mockResolvedValue({
      id: USER,
      email: 'ana@example.com',
      systemRole: SystemRole.USER,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      personalData: { firstName: 'Ana', lastName: 'Paz' },
    });
    usersRepo.save.mockImplementation(async (u: unknown) => u);

    const result = await service.setUserActive(USER, false);

    expect(usersRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER, isActive: false }),
    );
    expect(result).toEqual({
      id: USER,
      email: 'ana@example.com',
      systemRole: SystemRole.USER,
      firstName: 'Ana',
      lastName: 'Paz',
      isActive: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('S1 answers 404 with the documented message for an unknown user', async () => {
    usersRepo.findById.mockResolvedValue(null);

    await expect(service.setUserActive('missing', false)).rejects.toThrow(
      new NotFoundException('User missing not found'),
    );
    expect(usersRepo.save).not.toHaveBeenCalled();
  });

  // ── S2 · Activar/desactivar vínculo ─────────────────────────────

  it('S2 deactivates a bond and returns the bond shape with members and childrenCount', async () => {
    bondsRepo.findBondEnriched.mockResolvedValue({
      id: BOND,
      title: 'Acuerdo Paz',
      agreementType: 'formal',
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      members: [
        { id: 'm1', userId: USER, role: 'progenitor', user: { email: 'ana@example.com' } },
      ],
      children: [{ id: CHILD }, { id: 'child-2' }],
    });
    bondsRepo.save.mockImplementation(async (b: unknown) => b);

    const result = await service.setBondActive(BOND, false);

    expect(bondsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: BOND, isActive: false }),
    );
    expect(result).toEqual({
      id: BOND,
      title: 'Acuerdo Paz',
      agreementType: 'formal',
      isActive: false,
      members: [{ id: USER, email: 'ana@example.com', role: 'progenitor' }],
      childrenCount: 2,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('S2 answers 404 with the documented message for an unknown bond', async () => {
    bondsRepo.findBondEnriched.mockResolvedValue(null);

    await expect(service.setBondActive('missing', false)).rejects.toThrow(
      new NotFoundException('Bond missing not found'),
    );
  });

  // ── S3 · Editar/borrar hijo ─────────────────────────────────────

  it('S3 updates only the supplied child fields and returns the child shape', async () => {
    childrenRepo.findById.mockResolvedValue({
      id: CHILD,
      bondId: BOND,
      firstName: 'Mateo',
      lastName: 'Paz',
      dateOfBirth: '2020-05-15',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    childrenRepo.save.mockImplementation(async (c: unknown) => c);

    const result = await service.updateChild(CHILD, { firstName: 'Matías', dateOfBirth: null });

    expect(childrenRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CHILD,
        firstName: 'Matías',
        lastName: 'Paz',
        dateOfBirth: null,
      }),
    );
    expect(result).toEqual({
      id: CHILD,
      bondId: BOND,
      firstName: 'Matías',
      lastName: 'Paz',
      dateOfBirth: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('S3 answers 404 with the documented message for an unknown child', async () => {
    childrenRepo.findById.mockResolvedValue(null);

    await expect(service.updateChild('missing', { firstName: 'X' })).rejects.toThrow(
      new NotFoundException('Child missing not found'),
    );
    await expect(service.removeChild('missing')).rejects.toThrow(
      new NotFoundException('Child missing not found'),
    );
  });

  it('S3 deletes the child row it loaded', async () => {
    const child = { id: CHILD, bondId: BOND, firstName: 'Mateo', lastName: 'Paz' };
    childrenRepo.findById.mockResolvedValue(child);

    await service.removeChild(CHILD);

    expect(childrenRepo.remove).toHaveBeenCalledWith(child);
  });

  // ── S4 · Validación de fecha de nacimiento ──────────────────────

  describe('S4 child date validation', () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });

    const validate = (metatype: unknown, value: Record<string, unknown>) =>
      pipe.transform(value, { type: 'body', metatype: metatype as never });

    it('S4 rejects a date of birth that is not an ISO date', async () => {
      await expect(
        validate(AdminCreateChildDto, {
          firstName: 'Mateo',
          lastName: 'Paz',
          dateOfBirth: '15/05/2020',
        }),
      ).rejects.toThrow();
    });

    it('S4 rejects an empty string date of birth on create and update', async () => {
      await expect(
        validate(AdminCreateChildDto, { firstName: 'M', lastName: 'P', dateOfBirth: '' }),
      ).rejects.toThrow();
      await expect(validate(UpdateChildDto, { dateOfBirth: '' })).rejects.toThrow();
    });

    it('S4 accepts an ISO date and accepts omitting the field', async () => {
      await expect(
        validate(AdminCreateChildDto, {
          firstName: 'Mateo',
          lastName: 'Paz',
          dateOfBirth: '2020-05-15',
        }),
      ).resolves.toBeDefined();
      await expect(validate(UpdateChildDto, { firstName: 'Mateo' })).resolves.toBeDefined();
    });

    it('S4 lets update clear the date with null', async () => {
      const parsed = await validate(UpdateChildDto, { dateOfBirth: null });
      expect((parsed as UpdateChildDto).dateOfBirth).toBeNull();
    });
  });

  // ── S5 · Guardas de admin ───────────────────────────────────────

  it('S5 keeps the admin role and both guards on the controller', () => {
    const guards = Reflect.getMetadata('__guards__', AdminController);
    const roles = Reflect.getMetadata(ROLES_KEY, AdminController);

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(roles).toEqual([SystemRole.ADMIN]);
  });

  // ── S12 · Lo que ya existía no cambia ───────────────────────────

  it('S12 still rejects a bond that does not have exactly two members', async () => {
    await expect(
      service.createBond({
        title: 'X',
        agreementType: 'formal' as never,
        userIds: ['a'],
      }),
    ).rejects.toThrow('A bond must have exactly 2 members');
    expect(bondsRepo.createAndSave).not.toHaveBeenCalled();
  });

  it('S12 still returns the created user shape without the password hash', async () => {
    usersRepo.findOneByWhere.mockResolvedValue(null);
    usersRepo.createAndSave.mockResolvedValue({
      id: USER,
      email: 'ana@example.com',
      systemRole: SystemRole.USER,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    personalDataRepo.createAndSave.mockResolvedValue({});

    const result = await service.createUser({
      email: 'ana@example.com',
      password: 'secret123',
      firstName: 'Ana',
      lastName: 'Paz',
    });

    expect(result).toEqual({
      id: USER,
      email: 'ana@example.com',
      systemRole: SystemRole.USER,
      firstName: 'Ana',
      lastName: 'Paz',
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(JSON.stringify(result)).not.toContain('secret123');
  });
});
