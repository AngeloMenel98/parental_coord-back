import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger('WorkerBootstrap');

  app.enableShutdownHooks();

  const signals = ['SIGTERM', 'SIGINT'] as const;
  for (const signal of signals) {
    process.on(signal, () => {
      logger.log(`Received ${signal}, shutting down worker gracefully...`);
      void app.close().then(() => {
        logger.log('Worker closed.');
        process.exit(0);
      });
    });
  }

  logger.log('Activity timers worker running (consuming BullMQ jobs).');
}

void bootstrap();
