import 'dotenv/config';
import { DataSource } from 'typeorm';

if (!process.env.DB_PASSWORD) {
  throw new Error(
    'DB_PASSWORD environment variable is required for migrations. ' +
      'Set it before running: pnpm typeorm migration:run',
  );
}

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
