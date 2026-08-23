import { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const requestId = req.requestId || nanoid();
  const isFileTooLarge = err.code === "LIMIT_FILE_SIZE";
  const statusCode = isFileTooLarge ? 413 : err.statusCode || 500;
  const errorCode = isFileTooLarge
    ? "IMPORT_FILE_TOO_LARGE"
    : err.code || (statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST");
  const safeMessage =
    statusCode >= 500
      ? "An unexpected error occurred"
      : isFileTooLarge
        ? "The uploaded file exceeds the allowed size"
        : err.message || "Invalid request";

  if (req.log) {
    const fields = { errorCode, statusCode, method: req.method, path: req.path };
    if (statusCode >= 500) {
      req.log.error({ ...fields, err }, "request_failed");
    } else {
      req.log.warn(fields, "request_rejected");
    }
  }

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message: safeMessage,
      requestId,
    },
  });
}
