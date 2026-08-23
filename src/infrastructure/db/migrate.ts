import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index.js';
import { ILogger, silentLogger } from '../../domain/logging/logger.interface.js';
import { createLogger } from '../logging/pino-logger.js';

export async function runMigrations(logger: ILogger = silentLogger) {
  logger.info({}, 'migrations_started');
  await migrate(db, { migrationsFolder: './drizzle' });
  logger.info({}, 'migrations_completed');
}

if (process.argv[1]?.includes('migrate.ts')) {
  const logger = createLogger();
  runMigrations(logger)
    .then(() => pool.end())
    .catch((err) => {
      logger.error({ err }, 'migrations_failed');
      process.exit(1);
    });
}
