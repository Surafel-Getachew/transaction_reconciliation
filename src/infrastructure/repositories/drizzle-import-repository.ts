import { eq, sql } from "drizzle-orm";
import { Database } from "../db/index.js";
import {
  imports,
  ImportRecord,
  NewImportRecord,
} from "../db/schema/imports.js";
import { idempotencyKeys } from "../db/schema/idempotency.js";
import { IImportRepository } from "../../domain/repositories/import-repository.interface.js";

export class DrizzleImportRepository implements IImportRepository {
  constructor(private db: Database) {}

  async createWithIdempotency(
    newImport: NewImportRecord,
    idempotencyKey: string,
  ): Promise<{ importRecord: ImportRecord; isDuplicate: boolean }> {
    return await this.db.transaction(async (tx) => {
      // A check followed by an insert is not safe at READ COMMITTED isolation.
      // This transaction-scoped lock serializes only requests with this key.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))`,
      );

      // Check existing idempotency key
      const existingKey = await tx
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKey))
        .limit(1);

      if (existingKey.length > 0) {
        const existingImport = await tx
          .select()
          .from(imports)
          .where(eq(imports.id, existingKey[0].importId))
          .limit(1);

        if (existingImport.length > 0) {
          return { importRecord: existingImport[0], isDuplicate: true };
        }
      }

      // Insert new import
      const [insertedImport] = await tx
        .insert(imports)
        .values(newImport)
        .returning();

      // Insert idempotency key link
      await tx.insert(idempotencyKeys).values({
        key: idempotencyKey,
        importId: insertedImport.id,
      });

      return { importRecord: insertedImport, isDuplicate: false };
    });
  }

  async findById(id: string): Promise<ImportRecord | null> {
    const res = await this.db
      .select()
      .from(imports)
      .where(eq(imports.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findByIdempotencyKey(key: string): Promise<ImportRecord | null> {
    const res = await this.db
      .select({ import: imports })
      .from(idempotencyKeys)
      .innerJoin(imports, eq(idempotencyKeys.importId, imports.id))
      .where(eq(idempotencyKeys.key, key))
      .limit(1);

    return res[0]?.import || null;
  }
  async updateProgress(
    id: string,
    deltas: {
      processed: number;
      accepted: number;
      rejected: number;
      duplicates: number;
    },
  ): Promise<void> {
    await this.db
      .update(imports)
      .set({
        processedCount: sql`${imports.processedCount} + ${deltas.processed}`,
        acceptedCount: sql`${imports.acceptedCount} + ${deltas.accepted}`,
        rejectedCount: sql`${imports.rejectedCount} + ${deltas.rejected}`,
        duplicateCount: sql`${imports.duplicateCount} + ${deltas.duplicates}`,
      })
      .where(eq(imports.id, id));
  }

  async markStarted(id: string): Promise<void> {
    await this.db
      .update(imports)
      .set({
        status: "processing",
        startedAt: new Date(),
      })
      .where(eq(imports.id, id));
  }

  async markCompleted(
    id: string,
    status: "completed" | "failed" | "cancelled",
    failureReason?: string | null,
  ): Promise<void> {
    await this.db
      .update(imports)
      .set({
        status,
        completedAt: new Date(),
        failureReason: failureReason ?? null,
      })
      .where(eq(imports.id, id));
  }
}
