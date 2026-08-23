import { NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";
import { ILogger } from "../../domain/logging/logger.interface.js";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
    log: ILogger;
  }
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9_.-]{1,64}$/;

export function requestLogger(logger: ILogger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const supplied = req.headers["x-request-id"];
    req.requestId =
      typeof supplied === "string" && SAFE_REQUEST_ID.test(supplied)
        ? supplied
        : nanoid();
    req.log = logger.child({ requestId: req.requestId });
    res.setHeader("x-request-id", req.requestId);

    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      req.log.info(
        {
          method: req.method,
          path: req.route?.path ?? req.path,
          statusCode: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        },
        "http_request",
      );
    });

    next();
  };
}
