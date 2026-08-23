import { Router } from "express";
import multer from "multer";
import path from "node:path";
import swaggerUi from "swagger-ui-express";
import { ImportController } from "./controllers/import.controller.js";
import { openApiDocument } from "./openapi.js";

const upload = multer({
  dest: process.env.TEMP_UPLOAD_DIR || "./uploads",
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE_BYTES || "524288000", 10), // 500MB
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === ".ndjson") {
      cb(null, true);
    } else {
      const err: any = new Error(
        "Invalid file type. Only NDJSON files are supported.",
      );
      err.statusCode = 400;
      err.code = "INVALID_FILE_TYPE";
      cb(err);
    }
  },
});

export function createRouter(controller: ImportController): Router {
  const router = Router();

  router.get("/", (_req, res) => res.redirect("/docs"));
  router.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument as unknown as swaggerUi.JsonObject, {
      customSiteTitle: "Transaction Import & Reconciliation API",
      swaggerOptions: { displayRequestDuration: true, tryItOutEnabled: true },
    }),
  );

  // Health & Metrics
  router.get("/health/live", controller.getLiveness);
  router.get("/health/ready", controller.getReadiness);
  router.get("/metrics", controller.getMetrics);

  // Import API
  router.post("/v1/imports", upload.single("file"), controller.createImport);
  router.get("/v1/imports/:id", controller.getImportStatus);
  router.post("/v1/imports/:id/cancel", controller.cancelImport);
  router.get("/v1/imports/:id/summary", controller.getSummary);
  router.get("/v1/imports/:id/rejections", controller.getRejections);
  return router;
}
