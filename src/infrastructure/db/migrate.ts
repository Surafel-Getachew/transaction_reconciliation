import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index.js';

export async function runMigrations() {
  console.log('Running database migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations completed successfully.');
}

if (process.argv[1]?.includes('migrate.ts')) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
