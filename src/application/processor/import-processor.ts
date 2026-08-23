import readline from "node:readline";
import { nanoid } from "nanoid";
import { IImportRepository } from "../../domain/repositories/import-repository.interface.js";
import { ITransactionRepository } from "../../domain/repositories/transaction-repository.interface.js";
import { IRejectionRepository } from "../../domain/repositories/rejection-repository.interface.js";
import { IFileStorage } from "../../domain/storage/file-storage.interface.js";
import { IRiskWorkerPool } from "../../infrastructure/workers/worker-pool.js";
import { TransactionValidator } from "../../domain/services/validator.js";
import {
  TransactionNormalizer,
  NormalizedTransaction,
} from "../../domain/services/normalizer.js";
import { FingerprintCalculator } from "../../domain/services/fingerprint.js";
import { RiskInput } from "../../domain/services/risk-scorer.js";
import { NewTransactionRecord } from "../../infrastructure/db/schema/transactions.js";
import { NewRejectionRecord } from "../../infrastructure/db/schema/rejections.js";
import { MetricsMonitor } from "../../infrastructure/metrics/metrics-monitor.js";
import { IImportBatchPersister } from "../../domain/repositories/import-batch-persister.interface.js";
import { ILogger, silentLogger } from "../../domain/logging/logger.interface.js";

export interface ImportProcessorOptions {
  batchSize?: number;
  maxLineLength?: number;
  maxActiveImports?: number;
}

export class ImportProcessor {
  private batchSize: number;
  private maxLineLength: number;
  private maxActiveImports: number;
  private currentActiveImports = 0;

  constructor(
    private importRepo: IImportRepository,
    private transactionRepo: ITransactionRepository,
    private rejectionRepo: IRejectionRepository,
    private fileStorage: IFileStorage,
    private riskWorkerPool: IRiskWorkerPool,
    options?: ImportProcessorOptions,
    private batchPersister?: IImportBatchPersister,
    private logger: ILogger = silentLogger,
  ) {
    this.batchSize = options?.batchSize || 1000;
    this.maxLineLength = options?.maxLineLength || 1000000;
    this.maxActiveImports = options?.maxActiveImports || 2;
  }

  private limitedRawValue(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return { value: String(raw).slice(0, 200) };
    const record = raw as Record<string, unknown>;
    const allowed = [
      "transactionId",
      "accountId",
      "merchantId",
      "amount",
      "currency",
      "timestamp",
    ];
    return Object.fromEntries(
      allowed.flatMap((key) => {
        const value = record[key];
        if (value === undefined) return [];
        return [
          [
            key,
            typeof value === "string" ? value.slice(0, 256) : value,
          ] as const,
        ];
      }),
    );
  }

  async processImport(
    importId: string,
    filePath: string,
    providerId: string,
  ): Promise<void> {
    const importRecord = await this.importRepo.findById(importId);
    if (!importRecord) {
      throw new Error(`Import record ${importId} not found`);
    }

    if (
      importRecord.status === "cancelled" ||
      importRecord.status === "cancelling"
    ) {
      await this.importRepo.markCompleted(importId, "cancelled");
      await this.fileStorage.deleteFile(filePath);
      return;
    }

    // Enforce active import concurrency limit
    while (this.currentActiveImports >= this.maxActiveImports) {
      await new Promise((r) => setTimeout(r, 200));
    }

    this.currentActiveImports++;
    const metrics = MetricsMonitor.getInstance();
    metrics.incrementActiveImports();

    const log = this.logger.child({ importId, providerId });
    const startedAt = Date.now();
    let batchNumber = 0;

    await this.importRepo.markStarted(importId);
    log.info({ batchSize: this.batchSize }, "import_started");

    const readStream = this.fileStorage.getReadStream(filePath);
    const rl = readline.createInterface({
      input: readStream,
      crlfDelay: Infinity,
    });

    let lineNumber = 0;
    let pendingValid: Array<{
      normalized: NormalizedTransaction;
      fingerprint: string;
    }> = [];
    let pendingRejections: NewRejectionRecord[] = [];

    try {
      for await (const line of rl) {
        lineNumber++;
        const trimmedLine = line.trim();

        if (trimmedLine.length === 0) {
          continue;
        }

        if (line.length > this.maxLineLength) {
          pendingRejections.push({
            id: nanoid(),
            importId,
            lineNumber,
            reason: "EXCESSIVE_LINE_LENGTH",
            message: `Line exceeds maximum allowed length of ${this.maxLineLength} characters`,
            rawValue: { snippet: trimmedLine.substring(0, 100) + "..." },
          });
          continue;
        }

        let parsedJson: any;
        try {
          parsedJson = JSON.parse(trimmedLine);
        } catch {
          pendingRejections.push({
            id: nanoid(),
            importId,
            lineNumber,
            reason: "INVALID_JSON",
            message: "Line is not valid JSON",
            rawValue: { snippet: trimmedLine.substring(0, 200) },
          });
          continue;
        }

        const validation = TransactionValidator.validate(parsedJson);
        if (!validation.success) {
          pendingRejections.push({
            id: nanoid(),
            importId,
            lineNumber,
            reason: validation.errorCode || "VALIDATION_ERROR",
            message: validation.errorMessage || "Invalid record",
            rawValue: this.limitedRawValue(parsedJson),
          });
          continue;
        }

        const normalized = TransactionNormalizer.normalize(validation.data!);
        const fingerprint = FingerprintCalculator.calculate(normalized);

        pendingValid.push({ normalized, fingerprint });

        // Stream Backpressure: Pause stream reading while processing & persisting batch
        if (pendingValid.length + pendingRejections.length >= this.batchSize) {
          rl.pause();
          metrics.setQueueDepth(pendingValid.length + pendingRejections.length);

          const isCancelled = await this.flushBatch(
            importId,
            providerId,
            pendingValid,
            pendingRejections,
            log,
            ++batchNumber,
          );
          pendingValid = [];
          pendingRejections = [];
          metrics.setQueueDepth(0);

          if (isCancelled) {
            rl.close();
            break;
          }
          rl.resume();
        }
      }

      // Flush remaining items
      if (pendingValid.length > 0 || pendingRejections.length > 0) {
        const isCancelled = await this.flushBatch(
          importId,
          providerId,
          pendingValid,
          pendingRejections,
          log,
          ++batchNumber,
        );
        pendingValid = [];
        pendingRejections = [];
        if (isCancelled) rl.close();
      }

      // Check final status
      const finalState = await this.importRepo.findById(importId);
      const finalStatus =
        finalState?.status === "cancelling" || finalState?.status === "cancelled"
          ? "cancelled"
          : "completed";
      await this.importRepo.markCompleted(importId, finalStatus);
      log.info(
        {
          status: finalStatus,
          batchCount: batchNumber,
          recordCount: lineNumber,
          durationMs: Date.now() - startedAt,
        },
        "import_finished",
      );
    } catch (error: any) {
      await this.importRepo.markCompleted(
        importId,
        "failed",
        error?.message || "Processing error",
      );
      log.error(
        {
          err: error,
          errorCode: error?.code,
          batchCount: batchNumber,
          recordCount: lineNumber,
          durationMs: Date.now() - startedAt,
        },
        "import_failed",
      );
    } finally {
      this.currentActiveImports = Math.max(0, this.currentActiveImports - 1);
      metrics.decrementActiveImports();
      await this.fileStorage.deleteFile(filePath);
    }
  }

  private async flushBatch(
    importId: string,
    providerId: string,
    validItems: Array<{
      normalized: NormalizedTransaction;
      fingerprint: string;
    }>,
    rejectionItems: NewRejectionRecord[],
    log: ILogger,
    batchNumber: number,
  ): Promise<boolean> {
    const currentImport = await this.importRepo.findById(importId);
    if (
      currentImport?.status === "cancelling" ||
      currentImport?.status === "cancelled"
    ) {
      log.info({ batchNumber, status: currentImport.status }, "batch_skipped");
      return true;
    }

    const startedAt = Date.now();
    let insertedCount = 0;
    let duplicateCount = 0;

    if (validItems.length > 0) {
      // Worker pool risk score calculation
      const riskInputs: RiskInput[] = validItems.map((item) => {
        const txDate = new Date(item.normalized.timestamp);
        return {
          amount: item.normalized.amount,
          descriptionLength: item.normalized.description?.length || 0,
          transactionHour: isNaN(txDate.getTime()) ? 12 : txDate.getUTCHours(),
          merchantId: item.normalized.merchantId,
          fingerprint: item.fingerprint,
        };
      });

      const riskResults = await this.riskWorkerPool.processBatch(riskInputs);

      const txRecords: NewTransactionRecord[] = validItems.map((item, idx) => {
        const risk = riskResults[idx] || { riskScore: 0, riskLevel: "low" };
        return {
          id: nanoid(),
          importId,
          providerId,
          transactionId: item.normalized.transactionId,
          accountId: item.normalized.accountId,
          merchantId: item.normalized.merchantId,
          amount: item.normalized.amount.toFixed(2),
          currency: item.normalized.currency,
          timestamp: new Date(item.normalized.timestamp),
          description: item.normalized.description,
          fingerprint: item.fingerprint,
          riskScore: risk.riskScore,
          riskLevel: risk.riskLevel,
        };
      });

      if (this.batchPersister) {
        const insertResult = await this.batchPersister.persist({
          importId,
          transactions: txRecords,
          rejections: rejectionItems,
        });
        insertedCount = insertResult.insertedCount;
        duplicateCount = insertResult.duplicateCount;
      } else {
        const insertResult = await this.transactionRepo.batchInsert(txRecords);
        insertedCount = insertResult.insertedCount;
        duplicateCount = insertResult.duplicateCount;
        if (rejectionItems.length > 0)
          await this.rejectionRepo.batchInsert(rejectionItems);
      }
    } else if (rejectionItems.length > 0) {
      if (this.batchPersister) {
        await this.batchPersister.persist({
          importId,
          transactions: [],
          rejections: rejectionItems,
        });
      } else {
        await this.rejectionRepo.batchInsert(rejectionItems);
      }
    }

    const processedDelta = validItems.length + rejectionItems.length;
    const acceptedDelta = insertedCount;
    const rejectedDelta = rejectionItems.length;
    const duplicateDelta = duplicateCount;

    if (!this.batchPersister) {
      await this.importRepo.updateProgress(importId, {
        processed: processedDelta,
        accepted: acceptedDelta,
        rejected: rejectedDelta,
        duplicates: duplicateDelta,
      });
    }

    MetricsMonitor.getInstance().recordProcessedBatch(
      processedDelta,
      acceptedDelta,
      rejectedDelta,
      duplicateDelta,
    );

    log.debug(
      {
        batchNumber,
        recordCount: processedDelta,
        accepted: acceptedDelta,
        rejected: rejectedDelta,
        duplicates: duplicateDelta,
        durationMs: Date.now() - startedAt,
      },
      "batch_persisted",
    );

    return false;
  }
}
