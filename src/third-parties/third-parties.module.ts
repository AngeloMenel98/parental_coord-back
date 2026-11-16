import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogEntity } from '../audit/entities/audit-log.entity';
import { BondsModule } from '../bonds/bonds.module';
import { BondMemberEntity } from '../bonds/entities/bond-member.entity';
import { Clock } from '../common/clock/clock';
import { SystemClock } from '../common/clock/system-clock';
import { AuthThirdPartyEntity } from '../expenses/entities/auth-third-party.entity';
import { UserEntity } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { AuthThirdPartiesRepository } from './repositories/auth-third-parties.repository';
import { ThirdPartiesAuditRepository } from './repositories/third-parties-audit.repository';
import { ThirdPartiesController } from './third-parties.controller';
import { ThirdPartiesService } from './third-parties.service';

/**
 * Módulo del acceso temporal (T2).
 *
 * `AuthThirdPartyEntity` se registra ACÁ aunque su archivo viva en `expenses/entities`
 * (F6): el metadata de TypeORM es por módulo, y este es el módulo que ahora la usa y la
 * escribe. `ExpensesModule` la sigue registrando porque la entidad de participaciones
 * declara la relación inversa y con `autoLoadEntities` su metadata tiene que resolverse.
 *
 * `BondMemberEntity` y `UserEntity` entran en el `forFeature` porque el alta escribe la
 * membresía y el alta busca la cuenta por email; `AuditLogEntity` porque el audit del
 * grant reutiliza la tabla polimórfica existente.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuthThirdPartyEntity,
      BondMemberEntity,
      UserEntity,
      AuditLogEntity,
    ]),
    BondsModule,
    UsersModule,
  ],
  controllers: [ThirdPartiesController],
  providers: [
    AuthThirdPartiesRepository,
    ThirdPartiesAuditRepository,
    ThirdPartiesService,
    SystemClock,
    { provide: Clock, useExisting: SystemClock },
  ],
  exports: [ThirdPartiesService, AuthThirdPartiesRepository],
})
export class ThirdPartiesModule {}
