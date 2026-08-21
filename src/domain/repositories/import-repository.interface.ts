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
}
