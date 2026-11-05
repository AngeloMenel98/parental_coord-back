import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OutboxEventEntity } from './entities/outbox-event.entity';
import { OutboxEventRepository } from './repositories/outbox-event.repository';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEventEntity])],
  providers: [OutboxEventRepository],
  exports: [OutboxEventRepository],
})
export class OutboxModule {}
