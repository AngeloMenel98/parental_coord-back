/**
 * Idempotent seed script: creates an admin user in the database.
 *
 * Usage:  pnpm seed:admin
 * Env:    DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (or .env)
 */
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function seed() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? 'parental',
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME ?? 'parental_coordination',
    entities: ['src/**/*.entity.ts'],
    synchronize: false,
  });

  await ds.initialize();
  console.log('📦 Database connected');

  const userRepo = ds.getRepository('UserEntity');
  const personalDataRepo = ds.getRepository('PersonalDataEntity');

  const ADMIN_EMAIL = 'admin@admin.com';
  const ADMIN_PASSWORD = 'admin123';

  // Check if admin already exists
  const existing = await userRepo.findOneBy({ email: ADMIN_EMAIL });
  if (existing) {
    console.log(`ℹ️  Admin user "${ADMIN_EMAIL}" already exists (id: ${existing.id}). Skipping.`);
    await ds.destroy();
    return;
  }

  // Hash password
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  // Create user with admin role
  const user = userRepo.create({
    email: ADMIN_EMAIL,
    passwordHash,
    systemRole: 'admin',
    isActive: true,
  });
  const savedUser = await userRepo.save(user);

  // Create personal data
  const personalData = personalDataRepo.create({
    userId: savedUser.id,
    firstName: 'Admin',
    lastName: 'System',
  });
  await personalDataRepo.save(personalData);

  console.log(`✅ Admin user created:`);
  console.log(`   Email:    ${ADMIN_EMAIL}`);
  console.log(`   Password: ${ADMIN_PASSWORD}`);
  console.log(`   ID:       ${savedUser.id}`);

  await ds.destroy();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
