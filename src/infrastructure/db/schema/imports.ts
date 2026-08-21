import { pgTable, varchar, integer, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const importStatusEnum = pgEnum('import_status', [
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelling',
  'cancelled',
]);

export const imports = pgTable('imports', {
  id: varchar('id', { length: 255 }).primaryKey(),
  providerId: varchar('provider_id', { length: 255 }).notNull(),
  status: importStatusEnum('status').notNull().default('pending'),
  processedCount: integer('processed_count').notNull().default(0),
  acceptedCount: integer('accepted_count').notNull().default(0),
  rejectedCount: integer('rejected_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
  failureReason: text('failure_reason'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ImportRecord = typeof imports.$inferSelect;
export type NewImportRecord = typeof imports.$inferInsert;
