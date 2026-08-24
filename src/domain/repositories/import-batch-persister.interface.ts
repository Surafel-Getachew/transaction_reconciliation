import { NewRejection } from "../entities/rejection.entity.js";
import { NewTransaction } from "../entities/transaction.entity.js";

/** Carries the source line so a conflict can be reported against it. */
export type PendingTransaction = NewTransaction & { lineNumber: number };

export interface ImportBatch {
  importId: string;
  transactions: PendingTransaction[];
  rejections: NewRejection[];
}

export interface BatchPersistResult {
  insertedCount: number;
  /** Conflicts whose stored fingerprint matched: a harmless replay. */
  duplicateCount: number;
  /** Conflicts whose stored content differed; recorded as rejections. */
  conflictCount: number;
}

/** Commits records and their import counters as one database transaction. */
export interface IImportBatchPersister {
  persist(batch: ImportBatch): Promise<BatchPersistResult>;
}
