import express, { Express } from "express";
import cors from "cors";
import { Router } from "express";
import { errorHandler } from "./middlewares/error-handler.js";
import { MetricsMonitor } from "../infrastructure/metrics/metrics-monitor.js";

export function createApp(router: Router): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    res.on("finish", () => {});
    MetricsMonitor.getInstance().recordHttpRequest(res.statusCode);
    next();
  });

  app.use("/", router);

  app.use(errorHandler);

  return app;
}
