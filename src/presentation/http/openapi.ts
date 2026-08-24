

const MAX_FILE_SIZE_BYTES = parseInt(
  process.env.MAX_FILE_SIZE_BYTES || "524288000",
  10,
);

const errorResponse = (description: string, example: Record<string, string>) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
      example: { error: { ...example, requestId: "V1StGXR8_Z5jdHi6B-myT" } },
    },
  },
});

const importIdParam = {
  name: "id",
  in: "path",
  required: true,
  description: "Import identifier returned by POST /v1/imports.",
  schema: { type: "string" },
  example: "V1StGXR8_Z5jdHi6B-myT",
};

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Transaction Import & Reconciliation Service",
    version: "1.0.0",
    description: [
      "Imports large NDJSON transaction files, processes them asynchronously,",
      "and exposes reconciliation results.",
      "",
      "Uploads are streamed to disk and processed by a bounded job queue, so",
      "`POST /v1/imports` returns `202 Accepted` before processing finishes.",
      "Poll `GET /v1/imports/{id}` for progress.",
      "",
      "No authentication is required.",
    ].join("\n"),
  },
  servers: [
    { url: "/", description: "Current host" },
  ],
  tags: [
    { name: "Imports", description: "Create, monitor, and cancel imports." },
    { name: "Reconciliation", description: "Summaries and rejected records." },
    { name: "Operations", description: "Health checks and metrics." },
  ],
  paths: {
    "/v1/imports": {
      post: {
        tags: ["Imports"],
        summary: "Create an import",
        description: [
          "Accepts one NDJSON file as `multipart/form-data`. The file is streamed",
          "to storage — it is never buffered whole in memory — and processing runs",
          "in the background.",
          "",
          "`Idempotency-Key` is required. Repeating a request with the same key",
          "returns the original import instead of creating a second one, including",
          "when the requests race each other.",
        ].join("\n"),
        operationId: "createImport",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            description:
              "Client-generated key that makes retries safe. Reusing a key returns the existing import.",
            schema: { type: "string", maxLength: 255 },
            example: "b3f1c2e4-9a7d-4c1b-8f2a-6d5e4c3b2a19",
          },
          {
            name: "X-Provider-Id",
            in: "header",
            required: false,
            description:
              "Provider the file belongs to. Duplicate detection is scoped per provider. Defaults to `default_provider`.",
            schema: { type: "string" },
            example: "provider-acme",
          },
          {
            name: "providerId",
            in: "query",
            required: false,
            description: "Alternative to the `X-Provider-Id` header.",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: {
                    type: "string",
                    format: "binary",
                    description: `NDJSON file, one transaction per line. Must have a .ndjson extension and its content must begin with a JSON object — the filename and MIME type alone are not trusted. Maximum ${MAX_FILE_SIZE_BYTES} bytes.`,
                  },
                },
              },
            },
          },
        },
        responses: {
          "202": {
            description:
              "Import accepted and queued. Processing has not finished yet.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ImportAccepted" },
                example: {
                  id: "V1StGXR8_Z5jdHi6B-myT",
                  status: "pending",
                  createdAt: "2026-07-24T08:00:00.000Z",
                },
              },
            },
          },
          "400": errorResponse(
            "Missing idempotency key, missing file, or unsupported file type.",
            {
              code: "IDEMPOTENCY_KEY_REQUIRED",
              message: "Idempotency-Key header is required",
            },
          ),
          "413": errorResponse("Uploaded file exceeds the configured size limit.", {
            code: "IMPORT_FILE_TOO_LARGE",
            message: "The uploaded file exceeds the allowed size",
          }),
          "429": errorResponse(
            "Import queue is at capacity. Retry after in-flight imports drain.",
            {
              code: "IMPORT_QUEUE_FULL",
              message: "Import processing queue is at capacity",
            },
          ),
          "503": errorResponse("Service is shutting down and rejecting new work.", {
            code: "SERVICE_SHUTTING_DOWN",
            message: "Service is shutting down",
          }),
        },
      },
    },
    "/v1/imports/{id}": {
      get: {
        tags: ["Imports"],
        summary: "Get import status and progress",
        description:
          "Returns the current status and running counters. Counters advance as batches are committed, so they may lag the file position slightly.",
        operationId: "getImportStatus",
        parameters: [importIdParam],
        responses: {
          "200": {
            description: "Current import state.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ImportStatus" },
                example: {
                  id: "V1StGXR8_Z5jdHi6B-myT",
                  status: "processing",
                  progress: {
                    processed: 58200,
                    accepted: 57010,
                    rejected: 1190,
                    duplicates: 214,
                  },
                  startedAt: "2026-07-24T08:01:00.000Z",
                  completedAt: null,
                  failureReason: null,
                },
              },
            },
          },
          "404": errorResponse("No import exists with that id.", {
            code: "IMPORT_NOT_FOUND",
            message: "Import with id V1StGXR8_Z5jdHi6B-myT not found",
          }),
        },
      },
    },
    "/v1/imports/{id}/cancel": {
      post: {
        tags: ["Imports"],
        summary: "Request cancellation of an import",
        description: [
          "Moves the import to `cancelling`. Cancellation is cooperative: the",
          "processor stops at the next batch checkpoint and then sets `cancelled`,",
          "so already-committed batches are kept and no further rows are written.",
          "",
          "Imports already in a terminal state (`completed`, `failed`, `cancelled`)",
          "are returned unchanged.",
        ].join("\n"),
        operationId: "cancelImport",
        parameters: [importIdParam],
        responses: {
          "200": {
            description: "Cancellation request recorded, or import already terminal.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CancelResult" },
                example: {
                  id: "V1StGXR8_Z5jdHi6B-myT",
                  status: "cancelling",
                  message: "Import cancellation request submitted",
                },
              },
            },
          },
          "404": errorResponse("No import exists with that id.", {
            code: "IMPORT_NOT_FOUND",
            message: "Import with id V1StGXR8_Z5jdHi6B-myT not found",
          }),
        },
      },
    },
    "/v1/imports/{id}/summary": {
      get: {
        tags: ["Reconciliation"],
        summary: "Get reconciliation summary",
        description:
          "Aggregates are derived from persisted transactions at request time, so the summary always reflects what is actually stored. Safe to call while an import is still processing — it returns the totals committed so far. Currency and risk-level groups are complete; byMerchant and byAccount contain the top 100 groups ordered by total amount.",
        operationId: "getImportSummary",
        parameters: [importIdParam],
        responses: {
          "200": {
            description: "Reconciliation totals grouped by currency, risk level, merchant, and account.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReconciliationSummary" },
                example: {
                  importId: "V1StGXR8_Z5jdHi6B-myT",
                  totals: { accepted: 57010, rejected: 1190, duplicates: 214 },
                  byCurrency: [
                    {
                      currency: "USD",
                      transactionCount: 25000,
                      totalAmount: 4350210.42,
                    },
                  ],
                  byRiskLevel: { low: 41000, medium: 14000, high: 2010 },
                  byMerchant: [
                    {
                      id: "merchant-18",
                      transactionCount: 1200,
                      totalAmount: 184230.5,
                    },
                  ],
                  byAccount: [
                    {
                      id: "acc-201",
                      transactionCount: 340,
                      totalAmount: 51200.75,
                    },
                  ],
                },
              },
            },
          },
          "404": errorResponse("No import exists with that id.", {
            code: "IMPORT_NOT_FOUND",
            message: "Import summary for V1StGXR8_Z5jdHi6B-myT not found",
          }),
        },
      },
    },
    "/v1/imports/{id}/rejections": {
      get: {
        tags: ["Reconciliation"],
        summary: "List rejected records",
        description: [
          "Cursor-paginated list of records that failed validation. The cursor is",
          "the line number of the last item in the previous page; pass the",
          "`nextCursor` from a response to fetch the next page. `nextCursor` is",
          "absent on the final page.",
          "",
          "`rawValue` holds a truncated copy of the offending record — enough to",
          "identify it, not the full malformed payload.",
        ].join("\n"),
        operationId: "getImportRejections",
        parameters: [
          importIdParam,
          {
            name: "limit",
            in: "query",
            required: false,
            description:
              "Page size. Values outside the range are clamped rather than rejected.",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            description: "Line number to resume after, taken from `nextCursor`.",
            schema: { type: "integer", minimum: 0 },
          },
        ],
        responses: {
          "200": {
            description: "One page of rejected records.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PaginatedRejections" },
                example: {
                  items: [
                    {
                      lineNumber: 125,
                      reason: "INVALID_CURRENCY",
                      message: "Currency must be a supported three-letter code",
                      rawValue: { transactionId: "txn-100" },
                    },
                  ],
                  nextCursor: 125,
                },
              },
            },
          },
          "404": errorResponse("No import exists with that id.", {
            code: "IMPORT_NOT_FOUND",
            message: "Import with id V1StGXR8_Z5jdHi6B-myT not found",
          }),
        },
      },
    },
    "/health/live": {
      get: {
        tags: ["Operations"],
        summary: "Liveness probe",
        description:
          "Confirms the process is running and the event loop can serve a request. Deliberately checks no dependencies — a failing database must not cause a restart loop.",
        operationId: "getLiveness",
        responses: {
          "200": {
            description: "Process is alive.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "live" },
                    timestamp: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/health/ready": {
      get: {
        tags: ["Operations"],
        summary: "Readiness probe",
        description:
          "Confirms the process can serve traffic: the database answers a query and shutdown has not begun. Returns 503 during graceful shutdown so load balancers drain the instance.",
        operationId: "getReadiness",
        responses: {
          "200": {
            description: "Ready to accept traffic.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ready" },
                    database: { type: "string", example: "connected" },
                    timestamp: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "503": {
            description: "Not ready — shutting down or database unreachable.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "not_ready" },
                    reason: { type: "string", example: "shutting_down" },
                    database: { type: "string", example: "disconnected" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/metrics": {
      get: {
        tags: ["Operations"],
        summary: "Prometheus metrics",
        description:
          "Exposition-format metrics covering HTTP traffic, import throughput, queue depth, retries, and event-loop health.",
        operationId: "getMetrics",
        responses: {
          "200": {
            description: "Metrics in Prometheus text exposition format.",
            content: {
              "text/plain": {
                schema: { type: "string" },
                example:
                  "# HELP http_requests_total Total HTTP requests\n# TYPE http_requests_total counter\nhttp_requests_total 1024\n",
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      ImportStatusValue: {
        type: "string",
        description:
          "`pending` queued, `processing` in progress, `cancelling` stopping at the next checkpoint, and the terminal states `completed`, `failed`, `cancelled`.",
        enum: [
          "pending",
          "processing",
          "completed",
          "failed",
          "cancelling",
          "cancelled",
        ],
      },
      ImportAccepted: {
        type: "object",
        required: ["id", "status", "createdAt"],
        properties: {
          id: { type: "string" },
          status: { $ref: "#/components/schemas/ImportStatusValue" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      ImportStatus: {
        type: "object",
        required: ["id", "status", "progress"],
        properties: {
          id: { type: "string" },
          status: { $ref: "#/components/schemas/ImportStatusValue" },
          progress: {
            type: "object",
            required: ["processed", "accepted", "rejected", "duplicates"],
            properties: {
              processed: {
                type: "integer",
                description: "Lines read and classified so far.",
              },
              accepted: {
                type: "integer",
                description: "Transactions persisted.",
              },
              rejected: {
                type: "integer",
                description: "Records that failed validation.",
              },
              duplicates: {
                type: "integer",
                description:
                  "Records skipped because the transaction id was already accepted for this provider with identical content. A conflicting id whose content differs is counted under `rejected` with reason DUPLICATE_CONTENT_MISMATCH.",
              },
            },
          },
          startedAt: {
            type: "string",
            format: "date-time",
            nullable: true,
            description: "Null until processing begins.",
          },
          completedAt: {
            type: "string",
            format: "date-time",
            nullable: true,
            description: "Null until the import reaches a terminal state.",
          },
          failureReason: {
            type: "string",
            nullable: true,
            description:
              "Set only when status is `failed`. A fixed safe phrase chosen from a known set — never the underlying driver message, which can contain SQL and schema names.",
            example: "Processing results could not be saved",
          },
        },
      },
      CancelResult: {
        type: "object",
        required: ["id", "status", "message"],
        properties: {
          id: { type: "string" },
          status: { $ref: "#/components/schemas/ImportStatusValue" },
          message: { type: "string" },
        },
      },
      ReconciliationSummary: {
        type: "object",
        required: [
          "importId",
          "totals",
          "byCurrency",
          "byRiskLevel",
          "byMerchant",
          "byAccount",
        ],
        properties: {
          importId: { type: "string" },
          totals: {
            type: "object",
            required: ["accepted", "rejected", "duplicates"],
            properties: {
              accepted: { type: "integer" },
              rejected: { type: "integer" },
              duplicates: { type: "integer" },
            },
          },
          byCurrency: {
            type: "array",
            items: {
              type: "object",
              required: ["currency", "transactionCount", "totalAmount"],
              properties: {
                currency: { type: "string", example: "USD" },
                transactionCount: { type: "integer" },
                totalAmount: { type: "number", format: "double" },
              },
            },
          },
          byRiskLevel: {
            type: "object",
            description:
              "Counts by risk band: low 0–39, medium 40–69, high 70–100.",
            required: ["low", "medium", "high"],
            properties: {
              low: { type: "integer" },
              medium: { type: "integer" },
              high: { type: "integer" },
            },
          },
          byMerchant: {
            type: "array",
            items: { $ref: "#/components/schemas/GroupSummary" },
          },
          byAccount: {
            type: "array",
            items: { $ref: "#/components/schemas/GroupSummary" },
          },
        },
      },
      GroupSummary: {
        type: "object",
        required: ["id", "transactionCount", "totalAmount"],
        properties: {
          id: {
            type: "string",
            description: "Merchant or account identifier for the group.",
          },
          transactionCount: { type: "integer" },
          totalAmount: { type: "number", format: "double" },
        },
      },
      PaginatedRejections: {
        type: "object",
        required: ["items"],
        properties: {
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/Rejection" },
          },
          nextCursor: {
            type: "integer",
            description: "Omitted when there are no further pages.",
          },
        },
      },
      Rejection: {
        type: "object",
        required: ["lineNumber", "reason", "message"],
        properties: {
          lineNumber: {
            type: "integer",
            description: "1-based line number in the uploaded file.",
          },
          reason: {
            type: "string",
            description:
              "Stable machine-readable rejection code. `DUPLICATE_CONTENT_MISMATCH` means the same transactionId was already accepted for this provider with different content; the existing record was kept and this one discarded.",
            example: "INVALID_CURRENCY",
          },
          message: {
            type: "string",
            description: "Human-readable explanation.",
          },
          rawValue: {
            type: "object",
            nullable: true,
            additionalProperties: true,
            description:
              "Truncated excerpt of the rejected record. Large payloads are trimmed before persisting.",
          },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: {
                type: "string",
                description: "Stable error code, safe to branch on.",
              },
              message: {
                type: "string",
                description:
                  "Safe external message. Internal details are logged, never returned.",
              },
              requestId: {
                type: "string",
                description: "Correlates the response with server logs.",
              },
            },
          },
        },
      },
    },
  },
} as const;
