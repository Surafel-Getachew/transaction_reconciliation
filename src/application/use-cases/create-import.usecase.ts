import { nanoid } from "nanoid";
import { Readable } from "node:stream";
import { IImportRepository } from "../../domain/repositories/import-repository.interface.js";
import { IFileStorage } from "../../domain/storage/file-storage.interface.js";
import { ImportRecord } from "../../infrastructure/db/schema/imports.js";

export interface CreateImportDTO {
  idempotencyKey?: string;
  providerId?: string;
  fileStream: Readable;
}

export class CreateImportUseCase {
  constructor(
    private importRepo: IImportRepository,
    private fileStorage: IFileStorage,
  ) {}
  async execute(
    dto: CreateImportDTO,
  ): Promise<{ importRecord: ImportRecord; isDuplicate: boolean }> {
    if (!dto.idempotencyKey || dto.idempotencyKey.trim() === "") {
      const err: any = new Error("Idempotency-Key header is required");
      err.statusCode = 400;
      err.code = "IDEMPOTENCY_KEY_REQUIRED";
      throw err;
    }

    const key = dto.idempotencyKey.trim();
    const providerId = (dto.providerId || "default_provider").trim();

    // Check if key already exists before saving file
    const existing = await this.importRepo.findByIdempotencyKey(key);
    if (existing) {
      return { importRecord: existing, isDuplicate: true };
    }

    // TOOD: JOB QUEUE

    try {
      const importId = nanoid();
      const filePath = await this.fileStorage.saveStream(
        importId,
        dto.fileStream,
      );
      const { importRecord, isDuplicate } =
        await this.importRepo.createWithIdempotency(
          {
            id: importId,
            providerId,
            status: "pending",
            processedCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            duplicateCount: 0,
          },
          key,
        );
      if (isDuplicate) {
        await this.fileStorage.deleteFile(filePath);
        // TODO: release reservation here JOB QUEUE
        return { importRecord, isDuplicate: true };
      }
      // // TODO: check reservation
      return { importRecord, isDuplicate: false };
    } catch (error) {
      // TODO: release reservation JOB QUEUE
      throw error;
    }
  }
}
