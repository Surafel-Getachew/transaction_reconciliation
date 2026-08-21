import express, { Express } from "express";
import cors from "cors";
import { Router } from "express";
import { errorHandler } from "./middlewares/error-handler.js";

export function createApp(router: Router): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    res.on("finish", () => {});
    next();
  });

  app.use("/", router);

  app.use(errorHandler);

  return app;
}
