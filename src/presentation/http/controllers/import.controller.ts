import { Request, Response, NextFunction } from "express";
import { Readable } from "node:stream";
import fs from "node:fs";
import { CreateImportUseCase } from "../../../application/use-cases/create-import.usecase.js";

import { pool } from "../../../infrastructure/db/index.js";
export class ImportController {
  constructor(
    private createImportUseCase: CreateImportUseCase,
    private isAcceptingTraffic: () => boolean = () => true,
  ) {}

  public createImport = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!this.isAcceptingTraffic()) {
        return res.status(503).json({
          error: {
            code: "SERVICE_SHUTTING_DOWN",
            message: "Service is shutting down",
          },
        });
      }
      const idempotencyKey = req.headers["idempotency-key"] as string;
      const providerId =
        (req.headers["x-provider-id"] as string) ||
        (req.query.providerId as string);

      if (!idempotencyKey) {
        return res.status(400).json({
          error: {
            code: "IDEMPOTENCY_KEY_REQUIRED",
            message: "Idempotency-Key header is required",
          },
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: {
            code: "FILE_REQUIRED",
            message:
              'NDJSON file must be uploaded in multipart form field "file"',
          },
        });
      }

      const fileStream: Readable = req.file.path
        ? fs.createReadStream(req.file.path)
        : Readable.from(req.file.buffer);

      const result = await this.createImportUseCase.execute({
        idempotencyKey,
        providerId,
        fileStream,
      });

      res.status(202).json({
        id: result.importRecord.id,
        status: result.importRecord.status,
        createdAt: result.importRecord.createdAt.toISOString(),
      });
    } catch (error) {
      next(error);
    } finally {
      // Multer's staging file is distinct from the file owned by LocalFileStorage.
      // Always remove it, including idempotency, queue-capacity, and DB failures.
      if (req.file?.path) {
        try {
          await fs.promises.unlink(req.file.path);
        } catch {}
      }
    }
  };

  public getLiveness = async (_req: Request, res: Response) => {
    res
      .status(200)
      .json({ status: "live", timestamp: new Date().toISOString() });
  };

  public getReadiness = async (_req: Request, res: Response) => {
    if (!this.isAcceptingTraffic()) {
      return res
        .status(503)
        .json({ status: "not_ready", reason: "shutting_down" });
    }
    try {
      await pool.query("SELECT 1");
      res.status(200).json({
        status: "ready",
        database: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({ status: "not_ready", database: "disconnected" });
    }
  };
}
