import {
  ImportProgressDelta,
  ImportRecord,
  ImportStatus,
  NewImport,
  TerminalImportStatus,
} from "../entities/import.entity.js";

export interface IImportRepository {
  createWithIdempotency(
    newImport: NewImport,
    idempotencyKey: string,
  ): Promise<{ importRecord: ImportRecord; isDuplicate: boolean }>;
  findById(id: string): Promise<ImportRecord | null>;
  findByIdempotencyKey(key: string): Promise<ImportRecord | null>;
  updateStatus(
    id: string,
    status: ImportStatus,
    failureReason?: string | null,
  ): Promise<void>;
  updateProgress(id: string, deltas: ImportProgressDelta): Promise<void>;
  markStarted(id: string): Promise<void>;
  markCompleted(
    id: string,
    status: TerminalImportStatus,
    failureReason?: string | null,
  ): Promise<void>;
  releaseOwnedLeases(): Promise<void>;
}
