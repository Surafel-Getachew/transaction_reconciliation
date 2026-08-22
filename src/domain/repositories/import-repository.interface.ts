import {
  ImportRecord,
  NewImportRecord,
} from "../../infrastructure/db/schema/imports.js";

export interface IImportRepository {
  createWithIdempotency(
    newImport: NewImportRecord,
    idempotencyKey: string,
  ): Promise<{ importRecord: ImportRecord; isDuplicate: boolean }>;
  findById(id: string): Promise<ImportRecord | null>;
  findByIdempotencyKey(key: string): Promise<ImportRecord | null>;
  updateProgress(
    id: string,
    deltas: {
      processed: number;
      accepted: number;
      rejected: number;
      duplicates: number;
    },
  ): Promise<void>;
  markStarted(id: string): Promise<void>;
  markCompleted(
    id: string,
    status: "completed" | "failed" | "cancelled",
    failureReason?: string | null,
  ): Promise<void>;
}
