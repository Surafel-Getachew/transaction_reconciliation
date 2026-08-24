import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { IImportRepository } from "../../domain/repositories/import-repository.interface.js";
import { IFileStorage } from "../../domain/storage/file-storage.interface.js";
import { ImportProcessor } from "../processor/import-processor.js";
import { ImportRecord } from "../../domain/entities/import.entity.js";
import { IIdGenerator } from "../../domain/ids/id-generator.interface.js";
import { IImportJobQueue } from "../queue/import-job-queue.js";

export interface CreateImportDTO {
  idempotencyKey?: string;
  providerId?: string;
  fileStream: Readable;
}

export class CreateImportUseCase {
  constructor(
    private importRepo: IImportRepository,
    private fileStorage: IFileStorage,
    private importProcessor: ImportProcessor,
    private jobQueue?: IImportJobQueue,
    private ids: IIdGenerator = { generate: () => randomUUID() },
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

    const reservation = this.jobQueue?.reserve();
    if (this.jobQueue && !reservation) {
      const err: any = new Error("Import processing queue is at capacity");
      err.statusCode = 429;
      err.code = "IMPORT_QUEUE_FULL";
      throw err;
    }

    try {
      const importId = this.ids.generate();
      const filePath = await this.fileStorage.saveStream(
        importId,
        dto.fileStream,
      );

      const { importRecord, isDuplicate } =
        await this.importRepo.createWithIdempotency(
          { id: importId, providerId, status: "pending" },
          key,
        );

      if (isDuplicate) {
        await this.fileStorage.deleteFile(filePath);
        reservation?.release();
        return { importRecord, isDuplicate: true };
      }

      if (reservation) {
        reservation.enqueue({ importId, filePath, providerId });
      } else {
        setImmediate(
          () =>
            void this.importProcessor.processImport(
              importId,
              filePath,
              providerId,
            ),
        );
      }

      return { importRecord, isDuplicate: false };
    } catch (error) {
      reservation?.release();
      throw error;
    }
  }
}
