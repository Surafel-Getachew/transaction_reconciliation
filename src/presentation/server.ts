import express, { Express } from "express";
import cors from "cors";
import { Router } from "express";
import { errorHandler } from "./middlewares/error-handler.js";
import { requestLogger } from "./middlewares/request-logger.js";
import { MetricsMonitor } from "../infrastructure/metrics/metrics-monitor.js";
import { ILogger, silentLogger } from "../domain/logging/logger.interface.js";

export function createApp(
  router: Router,
  logger: ILogger = silentLogger,
): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  app.use(requestLogger(logger));

  app.use((req, res, next) => {
    res.on("finish", () => {
      MetricsMonitor.getInstance().recordHttpRequest(res.statusCode);
    });
    next();
  });

  app.use("/", router);

  app.use(errorHandler);

  return app;
}
