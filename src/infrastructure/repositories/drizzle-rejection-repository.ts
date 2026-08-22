import { eq, gt, and, asc } from "drizzle-orm";
import { Database } from "../db/index.js";
import { rejections, NewRejectionRecord } from "../db/schema/rejections.js";
import {
  IRejectionRepository,
  PaginatedRejections,
} from "../../domain/repositories/rejection-repository.interface.js";

export class DrizzleRejectionRepository implements IRejectionRepository {
  constructor(private db: Database) {}

  async batchInsert(records: NewRejectionRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.db.insert(rejections).values(records);
  }

  async findByImportIdPaginated(
    importId: string,
    limit: number,
    cursor?: number,
  ): Promise<PaginatedRejections> {
    const fetchLimit = limit + 1;

    const conditions = [eq(rejections.importId, importId)];
    if (cursor !== undefined && cursor !== null && !isNaN(cursor)) {
      conditions.push(gt(rejections.lineNumber, cursor));
    }

    const rows = await this.db
      .select({
        lineNumber: rejections.lineNumber,
        reason: rejections.reason,
        message: rejections.message,
        rawValue: rejections.rawValue,
      })
      .from(rejections)
      .where(and(...conditions))
      .orderBy(asc(rejections.lineNumber))
      .limit(fetchLimit);

    let nextCursor: number | undefined = undefined;
    if (rows.length > limit) {
      const extra = rows.pop();
      nextCursor = rows[rows.length - 1]?.lineNumber;
    }

    return {
      items: rows,
      nextCursor,
    };
  }
}
