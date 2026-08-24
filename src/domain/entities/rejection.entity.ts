export interface NewRejection {
  id: string;
  importId: string;
  lineNumber: number;
  reason: string;
  message: string;
  rawValue: Record<string, unknown> | null;
}

export interface Rejection {
  lineNumber: number;
  reason: string;
  message: string;
  rawValue: Record<string, unknown> | null;
}

export interface PaginatedRejections {
  items: Rejection[];
  nextCursor?: number;
}
