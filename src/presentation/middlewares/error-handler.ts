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
  const requestId = (req.headers["x-request-id"] as string) || nanoid();
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

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message: safeMessage,
      requestId,
    },
  });
}
