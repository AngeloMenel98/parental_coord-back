import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { PersonalDataEntity } from './entities/personal-data.entity';
import { UsersRepository } from './repositories/users.repository';
import { PersonalDataRepository } from './repositories/personal-data.repository';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, PersonalDataEntity])],
  providers: [UsersRepository, PersonalDataRepository],
  exports: [TypeOrmModule, UsersRepository, PersonalDataRepository],
})
export class UsersModule {}
