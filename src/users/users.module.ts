import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { PersonalDataEntity } from './entities/personal-data.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, PersonalDataEntity])],
  exports: [TypeOrmModule],
})
export class UsersModule {}
