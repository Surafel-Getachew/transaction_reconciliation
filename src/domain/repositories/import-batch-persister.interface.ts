import { NewRejectionRecord } from '../../infrastructure/db/schema/rejections.js';
import { NewTransactionRecord } from '../../infrastructure/db/schema/transactions.js';

export interface ImportBatch {
  importId: string;
  transactions: NewTransactionRecord[];
  rejections: NewRejectionRecord[];
}

export interface BatchPersistResult {
  insertedCount: number;
  duplicateCount: number;
}

/** Commits records and their import counters as one database transaction. */
export interface IImportBatchPersister {
  persist(batch: ImportBatch): Promise<BatchPersistResult>;
}
