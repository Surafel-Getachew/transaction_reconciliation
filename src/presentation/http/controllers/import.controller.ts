import { Request, Response, NextFunction } from "express";
import { Readable } from "node:stream";
import fs from "node:fs";
import { CreateImportUseCase } from "../../../application/use-cases/create-import.usecase.js";
import { GetImportStatusUseCase } from "../../../application/use-cases/get-import-status.usecase.js";
import { CancelImportUseCase } from "../../../application/use-cases/cancel-import.usecase.js";
import { GetSummaryUseCase } from "../../../application/use-cases/get-summary.usecase.js";
import { GetRejectionsUseCase } from "../../../application/use-cases/get-rejections.usecase.js";
import { MetricsMonitor } from "../../../infrastructure/metrics/metrics-monitor.js";
import { pool } from "../../../infrastructure/db/index.js";
import {
  NdjsonSniffer,
  NDJSON_SNIFF_BYTES,
} from "../../../domain/services/ndjson-sniffer.js";

async function readHead(
  filePath: string,
): Promise<{ head: string; truncated: boolean }> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(NDJSON_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, NDJSON_SNIFF_BYTES, 0);
    return {
      head: buffer.subarray(0, bytesRead).toString("utf8"),
      truncated: bytesRead === NDJSON_SNIFF_BYTES,
    };
  } finally {
    await handle.close();
  }
}

export class ImportController {
  constructor(
    private createImportUseCase: CreateImportUseCase,
    private getImportStatusUseCase: GetImportStatusUseCase,
    private cancelImportUseCase: CancelImportUseCase,
    private getSummaryUseCase: GetSummaryUseCase,
    private getRejectionsUseCase: GetRejectionsUseCase,
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

      const { head, truncated } = req.file.path
        ? await readHead(req.file.path)
        : {
            head: req.file.buffer
              .subarray(0, NDJSON_SNIFF_BYTES)
              .toString("utf8"),
            truncated: req.file.buffer.length > NDJSON_SNIFF_BYTES,
          };

      if (!NdjsonSniffer.looksLikeNdjson(head, truncated)) {
        return res.status(400).json({
          error: {
            code: "INVALID_FILE_TYPE",
            message: "File content is not valid NDJSON",
            requestId: req.requestId,
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

  public getImportStatus = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const id = String(req.params.id);
      const status = await this.getImportStatusUseCase.execute(id);
      res.status(200).json(status);
    } catch (error) {
      next(error);
    }
  };

  public cancelImport = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const id = String(req.params.id);
      const result = await this.cancelImportUseCase.execute(id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  public getSummary = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const id = String(req.params.id);
      const summary = await this.getSummaryUseCase.execute(id);
      res.status(200).json(summary);
    } catch (error) {
      next(error);
    }
  };

  public getRejections = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const id = String(req.params.id);
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : undefined;
      const cursor = req.query.cursor
        ? parseInt(req.query.cursor as string, 10)
        : undefined;

      const result = await this.getRejectionsUseCase.execute(id, limit, cursor);
      res.status(200).json(result);
    } catch (error) {
      next(error);
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

  public getMetrics = async (_req: Request, res: Response) => {
    const metrics = MetricsMonitor.getInstance();
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.status(200).send(metrics.formatPrometheusMetrics());
  };
}
