export type ImportStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled";

export type TerminalImportStatus = "completed" | "failed" | "cancelled";

export interface ImportRecord {
  id: string;
  providerId: string;
  status: ImportStatus;
  processedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  failureReason: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  ownerId: string | null;
  leaseExpiresAt: Date | null;
  attempts: number;
}

export interface NewImport {
  id: string;
  providerId: string;
  status?: ImportStatus;
}

export interface ImportProgressDelta {
  processed: number;
  accepted: number;
  rejected: number;
  duplicates: number;
}
