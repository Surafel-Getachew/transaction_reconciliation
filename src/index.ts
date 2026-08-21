import dotenv from "dotenv";
import { db, pool } from "./infrastructure/db/index.js";
import { DrizzleImportRepository } from "./infrastructure/repositories/drizzle-import-repository.js";
import { LocalFileStorage } from "./infrastructure/storage/local-file-storage.js";
import { runMigrations } from "./infrastructure/db/migrate.js";
import { CreateImportUseCase } from "./application/use-cases/create-import.usecase.js";
import { ImportController } from "./presentation/http/controllers/import.controller.js";
import { createRouter } from "./presentation/http/routes.js";
import { createApp } from "./presentation/server.js";
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

  // 1. Infrastructure dependencies
  const importRepo = new DrizzleImportRepository(db);
  const fileStorage = new LocalFileStorage(process.env.TEMP_UPLOAD_DIR);

  // 2. Application processor & use cases
  const createImportUseCase = new CreateImportUseCase(importRepo, fileStorage);

  // 3. Presentation controllers & HTTP server
  let acceptingTraffic = true;
  const controller = new ImportController(
    createImportUseCase,
    () => acceptingTraffic,
  );

  const router = createRouter(controller);
  const app = createApp(router);

  const port = parseInt(process.env.PORT || "3000", 10);
  const server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error("Fatal initialization error:", err);
  process.exit(1);
});
