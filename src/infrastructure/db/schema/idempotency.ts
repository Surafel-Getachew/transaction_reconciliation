import { pgTable, varchar, timestamp } from 'drizzle-orm/pg-core';
import { imports } from './imports.js';

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: varchar('key', { length: 255 }).primaryKey(),
  importId: varchar('import_id', { length: 255 })
    .notNull()
    .references(() => imports.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IdempotencyRecord = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyRecord = typeof idempotencyKeys.$inferInsert;
