import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([]),
  ],
  exports: [TypeOrmModule],
})
export class CommonRepositoryModule {}
