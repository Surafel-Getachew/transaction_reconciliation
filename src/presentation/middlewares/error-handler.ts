import { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  type?: string;
}

const UPLOAD_ERRORS: Record<
  string,
  { statusCode: number; code: string; message: string }
> = {
  LIMIT_FILE_SIZE: {
    statusCode: 413,
    code: "IMPORT_FILE_TOO_LARGE",
    message: "The uploaded file exceeds the allowed size",
  },
  LIMIT_FILE_COUNT: {
    statusCode: 400,
    code: "TOO_MANY_FILES",
    message: "Exactly one NDJSON file must be uploaded",
  },
  LIMIT_UNEXPECTED_FILE: {
    statusCode: 400,
    code: "UNEXPECTED_FILE_FIELD",
    message: 'The uploaded file must be sent in the "file" field',
  },
  LIMIT_PART_COUNT: {
    statusCode: 400,
    code: "TOO_MANY_PARTS",
    message: "The request contains too many multipart parts",
  },
  LIMIT_FIELD_COUNT: {
    statusCode: 400,
    code: "TOO_MANY_FIELDS",
    message: "The request contains too many form fields",
  },
};

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const requestId = req.requestId || nanoid();
  const uploadError = err.code ? UPLOAD_ERRORS[err.code] : undefined;
  const isBodyTooLarge = err.type === "entity.too.large";

  const statusCode =
    uploadError?.statusCode ?? (isBodyTooLarge ? 413 : err.statusCode || 500);
  const errorCode =
    uploadError?.code ??
    (isBodyTooLarge
      ? "REQUEST_BODY_TOO_LARGE"
      : statusCode >= 500
        ? // don't surface a driver code such as a SQLSTATE to the client
          "INTERNAL_SERVER_ERROR"
        : err.code || "BAD_REQUEST");
  const safeMessage =
    statusCode >= 500
      ? "An unexpected error occurred"
      : (uploadError?.message ??
        (isBodyTooLarge
          ? "The request body exceeds the allowed size"
          : err.message || "Invalid request"));

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
