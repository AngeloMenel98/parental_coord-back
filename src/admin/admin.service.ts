import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

import { SystemRole } from '../users/entities/user.entity';
import { BondMemberRole } from '../bonds/entities/bond-member.entity';
import { BondMemberEntity } from '../bonds/entities/bond-member.entity';
import { BondEntity } from '../bonds/entities/bond.entity';
import { ChildEntity } from '../children/entities/child.entity';
import { UsersRepository } from '../users/repositories/users.repository';
import { PersonalDataRepository } from '../users/repositories/personal-data.repository';
import { BondsRepository } from '../bonds/repositories/bonds.repository';
import { BondMembersRepository } from '../bonds/repositories/bond-members.repository';
import { ChildrenRepository } from '../children/repositories/children.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateBondDto } from './dto/create-bond.dto';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly personalDataRepo: PersonalDataRepository,
    private readonly bondsRepo: BondsRepository,
    private readonly bondMembersRepo: BondMembersRepository,
    private readonly childrenRepo: ChildrenRepository,
  ) {}

  // ── Users ────────────────────────────────────────────────────────

  async createUser(dto: CreateUserDto) {
    const existing = await this.usersRepo.findOneByWhere({ email: dto.email });
    if (existing) {
      throw new ConflictException(`Email "${dto.email}" is already registered`);
    }

    const hashed = await bcrypt.hash(dto.password, 10);
    const saved = await this.usersRepo.createAndSave({
      email: dto.email,
      passwordHash: hashed,
      systemRole: SystemRole.USER,
      isActive: true,
    });

    await this.personalDataRepo.createAndSave({
      userId: saved.id,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

    return {
      id: saved.id,
      email: saved.email,
      systemRole: saved.systemRole,
      firstName: dto.firstName,
      lastName: dto.lastName,
      isActive: saved.isActive,
      createdAt: saved.createdAt,
    };
  }

  async listUsers() {
    const users = await this.usersRepo.findAllWithPersonalData();

    return users.map((u) => this.toAdminUserView(u));
  }

  /**
   * B1 · S1 — activa o desactiva una cuenta sin borrar nada.
   *
   * Devuelve exactamente la forma de `GET /admin/users` para que la UI pueda
   * reemplazar la tarjeta con la respuesta sin recargar la lista.
   */
  async setUserActive(userId: string, isActive: boolean) {
    const user = await this.usersRepo.findById(userId, {
      relations: ['personalData'],
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    user.isActive = isActive;
    const saved = await this.usersRepo.save(user);

    return this.toAdminUserView(saved);
  }

  // ── Bonds ────────────────────────────────────────────────────────

  /**
   * B5 · crea el vínculo completo en una sola transacción.
   *
   * Antes eran tres escrituras sueltas: si fallaba la segunda quedaba un vínculo
   * sin progenitores, y si fallaba la tercera, uno sin hijos — un estado que el
   * producto considera inválido y que ninguna pantalla muestra. Ahora o entra
   * todo, o no entra nada.
   */
  async createBond(dto: CreateBondDto) {
    if (dto.userIds.length !== 2) {
      throw new BadRequestException('A bond must have exactly 2 members');
    }

    if (!dto.children || dto.children.length === 0) {
      throw new BadRequestException('A bond must have at least one child');
    }

    // Validate all users exist
    const users = await this.usersRepo.findByIds(dto.userIds);
    if (users.length !== dto.userIds.length) {
      throw new BadRequestException('One or more user IDs are invalid');
    }

    const savedBond = await this.bondsRepo.transaction(async (manager) => {
      const bond = await manager.save(
        manager.create(BondEntity, {
          title: dto.title,
          agreementType: dto.agreementType,
          isActive: true,
        }),
      );

      await manager.save(
        dto.userIds.map((userId) =>
          manager.create(BondMemberEntity, {
            bondId: bond.id,
            userId,
            role: BondMemberRole.PROGENITOR,
            joinedAt: new Date(),
          }),
        ),
      );

      await manager.save(
        dto.children.map((child) =>
          manager.create(ChildEntity, {
            bondId: bond.id,
            firstName: child.firstName,
            lastName: child.lastName,
            dateOfBirth: child.dateOfBirth ?? null,
          }),
        ),
      );

      return bond;
    });

    // S12 · la creación devuelve EXACTAMENTE la forma de `GET /admin/bonds`.
    // Antes devolvía `members: string[]` (los ids crudos) mientras la lista devolvía
    // objetos: el cliente, que tipa `members` como objetos, fallaba al decodificar una
    // respuesta 201 exitosa y mostraba un error con el vínculo YA creado en la base.
    const enriched = await this.bondsRepo.findBondEnriched(savedBond.id);
    return this.toBondAdminView(enriched ?? savedBond);
  }

  async listBonds() {
    const enrichedBonds = await this.bondsRepo.findAllBondsEnriched();

    return enrichedBonds.map((b) => this.toBondAdminView(b));
  }

  /**
   * B1 · S2 — activa o desactiva un vínculo completo.
   *
   * Devuelve la forma de `GET /admin/bonds`; desactivar un bond no toca sus
   * miembros, hijos ni historial.
   */
  async setBondActive(bondId: string, isActive: boolean) {
    const bond = await this.bondsRepo.findBondEnriched(bondId);
    if (!bond) throw new NotFoundException(`Bond ${bondId} not found`);

    bond.isActive = isActive;
    const saved = await this.bondsRepo.save(bond);

    return this.toBondAdminView(saved);
  }

  // ── Bond Members ─────────────────────────────────────────────────

  async addBondMember(bondId: string, userId: string) {
    const bond = await this.bondsRepo.findById(bondId);
    if (!bond) throw new NotFoundException(`Bond ${bondId} not found`);

    const user = await this.usersRepo.findById(userId);
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const existing = await this.bondMembersRepo.findOneByBondAndUser(bondId, userId);
    if (existing) {
      throw new ConflictException(`User ${userId} is already a member of this bond`);
    }

    const saved = await this.bondMembersRepo.createAndSave({
      bondId,
      userId,
      role: BondMemberRole.PROGENITOR,
      joinedAt: new Date(),
    });

    return { id: saved.id, bondId: saved.bondId, userId: saved.userId, role: saved.role };
  }

  // ── Children ─────────────────────────────────────────────────────

  async listBondChildren(bondId: string) {
    const bond = await this.bondsRepo.findById(bondId);
    if (!bond) throw new NotFoundException(`Bond ${bondId} not found`);

    return this.childrenRepo.findByBond(bondId);
  }

  async addChildToBond(bondId: string, dto: CreateChildDto) {
    const bond = await this.bondsRepo.findById(bondId);
    if (!bond) throw new NotFoundException(`Bond ${bondId} not found`);

    const saved = await this.childrenRepo.createAndSave({
      bondId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      dateOfBirth: dto.dateOfBirth ?? null,
    });

    return this.toAdminChildView(saved);
  }

  /** B1 · S3 — edición parcial; `dateOfBirth: null` borra la fecha. */
  async updateChild(childId: string, dto: UpdateChildDto) {
    const child = await this.childrenRepo.findById(childId);
    if (!child) throw new NotFoundException(`Child ${childId} not found`);

    // Sólo los campos realmente enviados: un `undefined` explícito no debe pisar
    // el valor guardado.
    const patch = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    );
    Object.assign(child, patch);

    const saved = await this.childrenRepo.save(child);
    return this.toAdminChildView(saved);
  }

  /** B1 · S3 — borra el hijo; 404 con el mensaje documentado si no existe. */
  async removeChild(childId: string): Promise<void> {
    const child = await this.childrenRepo.findById(childId);
    if (!child) throw new NotFoundException(`Child ${childId} not found`);

    await this.childrenRepo.remove(child);
  }

  // ── Vistas compartidas ───────────────────────────────────────────

  private toAdminUserView(u: {
    id: string;
    email: string;
    systemRole: SystemRole;
    isActive: boolean;
    createdAt: Date;
    personalData?: { firstName?: string; lastName?: string } | null;
  }) {
    return {
      id: u.id,
      email: u.email,
      systemRole: u.systemRole,
      firstName: u.personalData?.firstName ?? null,
      lastName: u.personalData?.lastName ?? null,
      isActive: u.isActive,
      createdAt: u.createdAt,
    };
  }

  private toBondAdminView(b: BondEntity) {
    return {
      id: b.id,
      title: b.title,
      agreementType: b.agreementType,
      isActive: b.isActive,
      members: (b.members ?? []).map((m) => ({
        id: m.userId,
        email: m.user?.email,
        role: m.role,
      })),
      childrenCount: b.children?.length ?? 0,
      createdAt: b.createdAt,
    };
  }

  private toAdminChildView(c: ChildEntity) {
    return {
      id: c.id,
      bondId: c.bondId,
      firstName: c.firstName,
      lastName: c.lastName,
      dateOfBirth: c.dateOfBirth,
      createdAt: c.createdAt,
    };
  }
}
