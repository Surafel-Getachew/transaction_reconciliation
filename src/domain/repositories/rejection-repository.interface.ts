import {
  NewRejection,
  PaginatedRejections,
} from "../entities/rejection.entity.js";

export type { PaginatedRejections };

export interface IRejectionRepository {
  batchInsert(records: NewRejection[]): Promise<void>;
  findByImportIdPaginated(
    importId: string,
    limit: number,
    cursor?: number,
  ): Promise<PaginatedRejections>;
}
