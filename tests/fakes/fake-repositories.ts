import { Readable } from 'node:stream';
import { IImportRepository } from '../../src/domain/repositories/import-repository.interface.js';
import { ITransactionRepository, ReconciliationSummary } from '../../src/domain/repositories/transaction-repository.interface.js';
import { IRejectionRepository, PaginatedRejections } from '../../src/domain/repositories/rejection-repository.interface.js';
import { IFileStorage } from '../../src/domain/storage/file-storage.interface.js';
import { ImportRecord, NewImportRecord } from '../../src/infrastructure/db/schema/imports.js';
import { NewTransactionRecord } from '../../src/infrastructure/db/schema/transactions.js';
import { NewRejectionRecord } from '../../src/infrastructure/db/schema/rejections.js';

export class FakeImportRepository implements IImportRepository {
  public imports = new Map<string, ImportRecord>();
  public idempotencyKeys = new Map<string, string>(); // key -> importId

  async createWithIdempotency(
    newImport: NewImportRecord,
    idempotencyKey: string
  ): Promise<{ importRecord: ImportRecord; isDuplicate: boolean }> {
    if (this.idempotencyKeys.has(idempotencyKey)) {
      const existingId = this.idempotencyKeys.get(idempotencyKey)!;
      return { importRecord: this.imports.get(existingId)!, isDuplicate: true };
    }

    const record: ImportRecord = {
      ...newImport,
      status: newImport.status || 'pending',
      processedCount: newImport.processedCount || 0,
      acceptedCount: newImport.acceptedCount || 0,
      rejectedCount: newImport.rejectedCount || 0,
      duplicateCount: newImport.duplicateCount || 0,
      failureReason: newImport.failureReason || null,
      startedAt: newImport.startedAt || null,
      completedAt: newImport.completedAt || null,
      createdAt: newImport.createdAt || new Date(),
    };

    this.imports.set(record.id, record);
    this.idempotencyKeys.set(idempotencyKey, record.id);

    return { importRecord: record, isDuplicate: false };
  }

  async findById(id: string): Promise<ImportRecord | null> {
    return this.imports.get(id) || null;
  }

  async findByIdempotencyKey(key: string): Promise<ImportRecord | null> {
    const importId = this.idempotencyKeys.get(key);
    if (!importId) return null;
    return this.imports.get(importId) || null;
  }

  async updateStatus(id: string, status: ImportRecord['status'], failureReason?: string | null): Promise<void> {
    const rec = this.imports.get(id);
    if (rec) {
      rec.status = status;
      if (failureReason !== undefined) rec.failureReason = failureReason;
    }
  }

  async updateProgress(
    id: string,
    deltas: { processed: number; accepted: number; rejected: number; duplicates: number }
  ): Promise<void> {
    const rec = this.imports.get(id);
    if (rec) {
      rec.processedCount += deltas.processed;
      rec.acceptedCount += deltas.accepted;
      rec.rejectedCount += deltas.rejected;
      rec.duplicateCount += deltas.duplicates;
    }
  }

  async markStarted(id: string): Promise<void> {
    const rec = this.imports.get(id);
    if (rec) {
      rec.status = 'processing';
      rec.startedAt = new Date();
    }
  }

  async markCompleted(
    id: string,
    status: 'completed' | 'failed' | 'cancelled',
    failureReason?: string | null
  ): Promise<void> {
    const rec = this.imports.get(id);
    if (rec) {
      rec.status = status;
      rec.completedAt = new Date();
      if (failureReason !== undefined) rec.failureReason = failureReason;
    }
  }
}

export class FakeTransactionRepository implements ITransactionRepository {
  public transactions: NewTransactionRecord[] = [];
  public seenUnique = new Set<string>(); // providerId:transactionId

  async batchInsert(
    records: NewTransactionRecord[]
  ): Promise<{ insertedCount: number; duplicateCount: number }> {
    let insertedCount = 0;
    let duplicateCount = 0;

    for (const r of records) {
      const key = `${r.providerId}:${r.transactionId}`;
      if (this.seenUnique.has(key)) {
        duplicateCount++;
      } else {
        this.seenUnique.add(key);
        this.transactions.push(r);
        insertedCount++;
      }
    }

    return { insertedCount, duplicateCount };
  }

  async getSummaryByImportId(importId: string): Promise<ReconciliationSummary | null> {
    const filtered = this.transactions.filter((t) => t.importId === importId);
    
    const byCurrencyMap = new Map<string, { count: number; total: number }>();
    const byMerchantMap = new Map<string, { count: number; total: number }>();
    const byAccountMap = new Map<string, { count: number; total: number }>();
    const byRiskLevel = { low: 0, medium: 0, high: 0 };

    for (const t of filtered) {
      const curr = t.currency;
      const currStats = byCurrencyMap.get(curr) || { count: 0, total: 0 };
      currStats.count++;
      currStats.total += Number(t.amount);
      byCurrencyMap.set(curr, currStats);

      const merchStats = byMerchantMap.get(t.merchantId) || { count: 0, total: 0 };
      merchStats.count++;
      merchStats.total += Number(t.amount);
      byMerchantMap.set(t.merchantId, merchStats);

      const accStats = byAccountMap.get(t.accountId) || { count: 0, total: 0 };
      accStats.count++;
      accStats.total += Number(t.amount);
      byAccountMap.set(t.accountId, accStats);

      if (t.riskLevel === 'low') byRiskLevel.low++;
      else if (t.riskLevel === 'medium') byRiskLevel.medium++;
      else if (t.riskLevel === 'high') byRiskLevel.high++;
    }

    return {
      importId,
      totals: {
        accepted: filtered.length,
        rejected: 0,
        duplicates: 0,
      },
      byCurrency: Array.from(byCurrencyMap.entries()).map(([currency, stats]) => ({
        currency,
        transactionCount: stats.count,
        totalAmount: stats.total,
      })),
      byRiskLevel,
      byMerchant: Array.from(byMerchantMap.entries()).map(([id, stats]) => ({
        id,
        transactionCount: stats.count,
        totalAmount: stats.total,
      })),
      byAccount: Array.from(byAccountMap.entries()).map(([id, stats]) => ({
        id,
        transactionCount: stats.count,
        totalAmount: stats.total,
      })),
    };
  }
}

export class FakeRejectionRepository implements IRejectionRepository {
  public rejections: NewRejectionRecord[] = [];

  async batchInsert(records: NewRejectionRecord[]): Promise<void> {
    this.rejections.push(...records);
  }

  async findByImportIdPaginated(
    importId: string,
    limit: number,
    cursor?: number
  ): Promise<PaginatedRejections> {
    const filtered = this.rejections
      .filter((r) => r.importId === importId && (cursor === undefined || r.lineNumber > cursor))
      .sort((a, b) => a.lineNumber - b.lineNumber);

    const items = filtered.slice(0, limit).map((r) => ({
      lineNumber: r.lineNumber,
      reason: r.reason,
      message: r.message,
      rawValue: r.rawValue,
    }));

    let nextCursor: number | undefined = undefined;
    if (filtered.length > limit) {
      nextCursor = items[items.length - 1].lineNumber;
    }

    return { items, nextCursor };
  }
}

export class FakeFileStorage implements IFileStorage {
  public files = new Map<string, string>(); // path -> content

  async saveStream(fileId: string, stream: Readable): Promise<string> {
    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const content = chunks.map((c) => (typeof c === 'string' ? c : c.toString('utf-8'))).join('');
    const filePath = `/tmp/fake-${fileId}.ndjson`;
    this.files.set(filePath, content);
    return filePath;
  }

  getReadStream(filePath: string): Readable {
    const content = this.files.get(filePath) || '';
    return Readable.from([content]);
  }

  async deleteFile(filePath: string): Promise<void> {
    this.files.delete(filePath);
  }
}
