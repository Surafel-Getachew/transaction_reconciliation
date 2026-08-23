import dotenv from "dotenv";
import { db, pool } from "./infrastructure/db/index.js";
import { DrizzleImportRepository } from "./infrastructure/repositories/drizzle-import-repository.js";
import { DrizzleTransactionRepository } from "./infrastructure/repositories/drizzle-transaction-repository.js";
import { DrizzleRejectionRepository } from "./infrastructure/repositories/drizzle-rejection-repository.js";
import { DrizzleImportBatchPersister } from "./infrastructure/repositories/drizzle-import-batch-persister.js";
import { LocalFileStorage } from "./infrastructure/storage/local-file-storage.js";
import { RiskWorkerPool } from "./infrastructure/workers/worker-pool.js";
import { ImportProcessor } from "./application/processor/import-processor.js";
import { runMigrations } from "./infrastructure/db/migrate.js";
import { CreateImportUseCase } from "./application/use-cases/create-import.usecase.js";
import { ImportController } from "./presentation/http/controllers/import.controller.js";
import { GetImportStatusUseCase } from "./application/use-cases/get-import-status.usecase.js";
import { CancelImportUseCase } from "./application/use-cases/cancel-import.usecase.js";
import { GetSummaryUseCase } from "./application/use-cases/get-summary.usecase.js";
import { GetRejectionsUseCase } from "./application/use-cases/get-rejections.usecase.js";
import { createRouter } from "./presentation/http/routes.js";
import { createApp } from "./presentation/server.js";
import { JobRecoveryService } from "./infrastructure/recovery/job-recovery.js";
import { ImportJobQueue } from "./application/queue/import-job-queue.js";

dotenv.config();

async function main() {
  console.log("Starting Transaction Import and Reconciliation Service...");

  // Auto-run migrations on startup if configured
  if (process.env.AUTO_MIGRATE !== "false") {
    try {
      await runMigrations();
    } catch (err) {
      console.warn("Migration auto-run warning:", err);
    }
  }

  // Job Recovery for stale/interrupted jobs
  const jobRecovery = new JobRecoveryService(db);
  try {
    await jobRecovery.recoverStaleJobs();
  } catch (err) {
    console.warn("Job recovery warning:", err);
  }

  // 1. Infrastructure dependencies
  const importRepo = new DrizzleImportRepository(db);
  const transactionRepo = new DrizzleTransactionRepository(db);
  const rejectionRepo = new DrizzleRejectionRepository(db);
  const batchPersister = new DrizzleImportBatchPersister(db);
  const fileStorage = new LocalFileStorage(process.env.TEMP_UPLOAD_DIR);
  const riskWorkerPool = new RiskWorkerPool(
    process.env.WORKER_CONCURRENCY
      ? parseInt(process.env.WORKER_CONCURRENCY, 10)
      : undefined,
  );

  // 2. Application processor & use cases
  const importProcessor = new ImportProcessor(
    importRepo,
    transactionRepo,
    rejectionRepo,
    fileStorage,
    riskWorkerPool,
    {
      batchSize: process.env.BATCH_SIZE
        ? parseInt(process.env.BATCH_SIZE, 10)
        : 1000,
    },
    batchPersister,
  );

  const importQueue = new ImportJobQueue(
    (job) =>
      importProcessor.processImport(job.importId, job.filePath, job.providerId),
    process.env.MAX_ACTIVE_IMPORTS
      ? parseInt(process.env.MAX_ACTIVE_IMPORTS, 10)
      : 2,
    process.env.MAX_PENDING_IMPORTS
      ? parseInt(process.env.MAX_PENDING_IMPORTS, 10)
      : 20,
  );

  const createImportUseCase = new CreateImportUseCase(
    importRepo,
    fileStorage,
    importProcessor,
    importQueue,
  );
  const getImportStatusUseCase = new GetImportStatusUseCase(importRepo);
  const cancelImportUseCase = new CancelImportUseCase(importRepo);
  const getSummaryUseCase = new GetSummaryUseCase(transactionRepo);
  const getRejectionsUseCase = new GetRejectionsUseCase(
    rejectionRepo,
    importRepo,
  );

  // 3. Presentation controllers & HTTP server
  let acceptingTraffic = true;
  const controller = new ImportController(
    createImportUseCase,
    getImportStatusUseCase,
    cancelImportUseCase,
    getSummaryUseCase,
    getRejectionsUseCase,
    () => acceptingTraffic,
  );

  const router = createRouter(controller);
  const app = createApp(router);

  const port = parseInt(process.env.PORT || "3000", 10);
  const server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });

  // Graceful shutdown handling
  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    acceptingTraffic = false;
    importQueue.stopAccepting();
    console.log(`Received ${signal}. Starting graceful shutdown...`);

    // Force exit timeout
    const forceExitTimer = setTimeout(() => {
      console.error("Graceful shutdown timeout exceeded. Exiting forcibly.");
      process.exit(1);
    }, 10000);

    server.close(async () => {
      console.log("HTTP server closed.");
      try {
        await importQueue.drain();
        await riskWorkerPool.destroy();
        await pool.end();
        console.log("Database connections closed.");
        clearTimeout(forceExitTimer);
        process.exit(0);
      } catch (err) {
        console.error("Error during shutdown:", err);
        clearTimeout(forceExitTimer);
        process.exit(1);
      }
    });
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal initialization error:", err);
  process.exit(1);
});
