import { Router } from "express";
import path from "node:path";
import { ImportController } from "./controllers/import.controller.js";

export function createRouter(controller: ImportController): Router {
  const router = Router();

  // Health & Metrics
  router.get("/health/live", controller.getLiveness);
  router.get("/health/ready", controller.getReadiness);

  return router;
}
