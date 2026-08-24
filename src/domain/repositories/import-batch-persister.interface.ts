import { NewRejection } from "../entities/rejection.entity.js";
import { NewTransaction } from "../entities/transaction.entity.js";

export interface ImportBatch {
  importId: string;
  transactions: NewTransaction[];
  rejections: NewRejection[];
}

export interface BatchPersistResult {
  insertedCount: number;
  duplicateCount: number;
}

/** Commits records and their import counters as one database transaction. */
export interface IImportBatchPersister {
  persist(batch: ImportBatch): Promise<BatchPersistResult>;
}
