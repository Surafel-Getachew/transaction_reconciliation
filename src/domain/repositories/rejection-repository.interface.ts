import {
  NewRejectionRecord,
  RejectionRecord,
} from "../../infrastructure/db/schema/rejections.js";

export interface PaginatedRejections {
  items: Array<{
    lineNumber: number;
    reason: string;
    message: string;
    rawValue: any;
  }>;
  nextCursor?: number;
}

export interface IRejectionRepository {
  batchInsert(records: NewRejectionRecord[]): Promise<void>;
  findByImportIdPaginated(
    importId: string,
    limit: number,
    cursor?: number,
  ): Promise<PaginatedRejections>;
}
