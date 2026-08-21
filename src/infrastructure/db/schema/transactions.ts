import { pgTable, varchar, numeric, integer, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { imports } from './imports.js';

export const transactions = pgTable(
  'transactions',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    importId: varchar('import_id', { length: 255 })
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    providerId: varchar('provider_id', { length: 255 }).notNull(),
    transactionId: varchar('transaction_id', { length: 255 }).notNull(),
    accountId: varchar('account_id', { length: 255 }).notNull(),
    merchantId: varchar('merchant_id', { length: 255 }).notNull(),
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    description: text('description'),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    riskScore: integer('risk_score').notNull(),
    riskLevel: varchar('risk_level', { length: 20 }).notNull(), // low, medium, high
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_provider_transaction_idx').on(table.providerId, table.transactionId),
    index('import_id_idx').on(table.importId),
    index('import_currency_idx').on(table.importId, table.currency),
    index('import_risk_level_idx').on(table.importId, table.riskLevel),
  ]
);

export type TransactionRecord = typeof transactions.$inferSelect;
export type NewTransactionRecord = typeof transactions.$inferInsert;
