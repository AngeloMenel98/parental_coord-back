import { DataSource } from 'typeorm';

if (!process.env.DB_PASSWORD) {
  throw new Error(
    'DB_PASSWORD environment variable is required for migrations. ' +
      'Set it before running: pnpm typeorm migration:run -d src/data-source.ts',
  );
}

/**
 * Migration DataSource for the TypeORM CLI (`pnpm typeorm ... -d src/data-source.ts`).
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'parental',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? 'parental_coordination',
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
