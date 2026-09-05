import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Helmet — security headers
  app.use(helmet());

  // CORS
  const corsOrigins = configService.get<string>('CORS_ORIGINS');
  app.enableCors({
    origin: corsOrigins ? corsOrigins.split(',') : '*',
    credentials: true,
  });

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  configureApp(app);

  // Graceful shutdown
  app.enableShutdownHooks();

  const signals = ['SIGTERM', 'SIGINT'] as const;
  for (const signal of signals) {
    process.on(signal, () => {
      logger.log(`Received ${signal}, shutting down gracefully...`);
      app.close().then(() => {
        logger.log('Application closed.');
        process.exit(0);
      });
    });
  }

  const port = configService.get<number>('PORT') ?? 3000;
  await app.listen(port);
  logger.log(`Application running on port ${port}`);
}
void bootstrap();
