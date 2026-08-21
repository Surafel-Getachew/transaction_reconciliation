import { pgTable, varchar, integer, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { imports } from './imports.js';

export const rejections = pgTable(
  'rejections',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    importId: varchar('import_id', { length: 255 })
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    lineNumber: integer('line_number').notNull(),
    reason: varchar('reason', { length: 100 }).notNull(),
    message: text('message').notNull(),
    rawValue: jsonb('raw_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('rejections_import_line_idx').on(table.importId, table.lineNumber),
  ]
);

export type RejectionRecord = typeof rejections.$inferSelect;
export type NewRejectionRecord = typeof rejections.$inferInsert;
