import { eq, sql } from "drizzle-orm";
import {
  IImportBatchPersister,
  ImportBatch,
  BatchPersistResult,
} from "../../domain/repositories/import-batch-persister.interface.js";
import { Database } from "../db/index.js";
import { imports } from "../db/schema/imports.js";
import { rejections } from "../db/schema/rejections.js";
import { transactions } from "../db/schema/transactions.js";
import {
  IRetryPolicy,
  noRetryPolicy,
} from "../../domain/retry/retry-policy.interface.js";

export class DrizzleImportBatchPersister implements IImportBatchPersister {
  constructor(
    private readonly db: Database,
    private readonly retryPolicy: IRetryPolicy = noRetryPolicy,
    private readonly leaseTtlMs = 60_000,
  ) {}

  async persist(batch: ImportBatch): Promise<BatchPersistResult> {
    return this.retryPolicy.execute(
      () => this.persistOnce(batch),
      { operationName: "persist_import_batch" },
    );
  }

  private async persistOnce(batch: ImportBatch): Promise<BatchPersistResult> {
    return this.db.transaction(async (tx) => {
      const insertedRows =
        batch.transactions.length === 0
          ? []
          : await tx
              .insert(transactions)
              .values(batch.transactions)
              .onConflictDoNothing({
                target: [transactions.providerId, transactions.transactionId],
              })
              .returning({ id: transactions.id });

      if (batch.rejections.length > 0) {
        await tx.insert(rejections).values(batch.rejections);
      }

      const insertedCount = insertedRows.length;
      const duplicateCount = batch.transactions.length - insertedCount;
      await tx
        .update(imports)
        .set({
          processedCount: sql`${imports.processedCount} + ${batch.transactions.length + batch.rejections.length}`,
          acceptedCount: sql`${imports.acceptedCount} + ${insertedCount}`,
          rejectedCount: sql`${imports.rejectedCount} + ${batch.rejections.length}`,
          duplicateCount: sql`${imports.duplicateCount} + ${duplicateCount}`,
          // Committing a batch proves the worker is alive, so it doubles as the
          // lease heartbeat and costs no extra query.
          leaseExpiresAt: new Date(Date.now() + this.leaseTtlMs),
        })
        .where(eq(imports.id, batch.importId));

      return { insertedCount, duplicateCount };
    });
  }
}
