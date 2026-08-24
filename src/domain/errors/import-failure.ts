export type ImportFailureCode =
  | "STORAGE_READ_FAILED"
  | "PERSISTENCE_FAILED"
  | "CANCELLED"
  | "PROCESSING_FAILED";

export interface ImportFailure {
  code: ImportFailureCode;
  /** Safe to return over the API: never derived from the underlying error text. */
  reason: string;
}

const FAILURES: Record<ImportFailureCode, string> = {
  STORAGE_READ_FAILED: "The uploaded file could not be read",
  PERSISTENCE_FAILED: "Processing results could not be saved",
  CANCELLED: "Processing was cancelled",
  PROCESSING_FAILED: "The import failed during processing",
};

const FILESYSTEM_CODES = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "EISDIR",
  "EMFILE",
  "ENOSPC",
  "EIO",
]);


export function classifyImportFailure(error: unknown): ImportFailure {
  const code = errorCodeOf(error);

  if (code === "ABORT_ERR" || nameOf(error) === "AbortError") {
    return { code: "CANCELLED", reason: FAILURES.CANCELLED };
  }
  if (code && FILESYSTEM_CODES.has(code)) {
    return { code: "STORAGE_READ_FAILED", reason: FAILURES.STORAGE_READ_FAILED };
  }
  // Postgres surfaces a five-character SQLSTATE; node-postgres also sets `severity`.
  if ((code && /^[0-9A-Z]{5}$/.test(code)) || hasField(error, "severity")) {
    return { code: "PERSISTENCE_FAILED", reason: FAILURES.PERSISTENCE_FAILED };
  }
  return { code: "PROCESSING_FAILED", reason: FAILURES.PROCESSING_FAILED };
}

function errorCodeOf(error: unknown): string | undefined {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === "string" ? value : undefined;
}

function nameOf(error: unknown): string | undefined {
  const value = (error as { name?: unknown } | null)?.name;
  return typeof value === "string" ? value : undefined;
}

function hasField(error: unknown, field: string): boolean {
  return (
    typeof error === "object" && error !== null && field in (error as object)
  );
}
