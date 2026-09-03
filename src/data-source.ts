import { DataSource } from 'typeorm';

/**
 * Migration DataSource for the TypeORM CLI (`pnpm typeorm ... -d src/data-source.ts`).
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'parental',
  password: process.env.DB_PASSWORD ?? 'parental_secret',
  database: process.env.DB_NAME ?? 'parental_coordination',
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
