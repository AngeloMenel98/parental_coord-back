import 'dotenv/config';
import { DataSource } from 'typeorm';
import { join } from 'path';

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
  // Managed Postgres (Supabase/Neon) requires SSL. Opt-in via DB_SSL=true
  // so local dev against plain Postgres keeps working.
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
});
