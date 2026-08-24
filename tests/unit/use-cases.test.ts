import { describe, it, expect, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import {
  FakeImportRepository,
  FakeTransactionRepository,
  FakeRejectionRepository,
  FakeFileStorage,
} from '../fakes/fake-repositories.js';
import { CreateImportUseCase } from '../../src/application/use-cases/create-import.usecase.js';
import { GetImportStatusUseCase } from '../../src/application/use-cases/get-import-status.usecase.js';
import { CancelImportUseCase } from '../../src/application/use-cases/cancel-import.usecase.js';
import { GetSummaryUseCase } from '../../src/application/use-cases/get-summary.usecase.js';
import { GetRejectionsUseCase } from '../../src/application/use-cases/get-rejections.usecase.js';
import { ImportProcessor } from '../../src/application/processor/import-processor.js';
import { IRiskWorkerPool } from '../../src/infrastructure/workers/worker-pool.js';
import { RiskInput, RiskResult } from '../../src/domain/services/risk-scorer.js';

class MockWorkerPool implements IRiskWorkerPool {
  async processBatch(items: RiskInput[]): Promise<RiskResult[]> {
    return items.map(() => ({ riskScore: 25, riskLevel: 'low' }));
  }
  async destroy(): Promise<void> {}
}

describe('Use Cases (with In-Memory Fake Dependencies)', () => {
  let importRepo: FakeImportRepository;
  let transactionRepo: FakeTransactionRepository;
  let rejectionRepo: FakeRejectionRepository;
  let fileStorage: FakeFileStorage;
  let workerPool: MockWorkerPool;
  let processor: ImportProcessor;

  beforeEach(() => {
    importRepo = new FakeImportRepository();
    transactionRepo = new FakeTransactionRepository();
    rejectionRepo = new FakeRejectionRepository();
    fileStorage = new FakeFileStorage();
    workerPool = new MockWorkerPool();

    processor = new ImportProcessor(
      importRepo,
      transactionRepo,
      rejectionRepo,
      fileStorage,
      workerPool,
      { batchSize: 5 }
    );
  });

  it('CreateImportUseCase should require Idempotency-Key header', async () => {
    const createUseCase = new CreateImportUseCase(importRepo, fileStorage, processor);
    await expect(
      createUseCase.execute({
        idempotencyKey: '',
        fileStream: Readable.from(['{"test":1}\n']),
      })
    ).rejects.toThrow('Idempotency-Key header is required');
  });

  it('CreateImportUseCase should return existing import when idempotency key is repeated', async () => {
    const createUseCase = new CreateImportUseCase(importRepo, fileStorage, processor);
    const key = 'idem-key-123';

    const res1 = await createUseCase.execute({
      idempotencyKey: key,
      fileStream: Readable.from(['{"transactionId":"txn-1","accountId":"acc-1","merchantId":"mer-1","amount":10,"currency":"USD","timestamp":"2026-07-20T10:00:00.000Z"}\n']),
    });

    expect(res1.isDuplicate).toBe(false);
    expect(res1.importRecord.id).toBeDefined();

    // Repeat with same key
    const res2 = await createUseCase.execute({
      idempotencyKey: key,
      fileStream: Readable.from(['different content\n']),
    });

    expect(res2.isDuplicate).toBe(true);
    expect(res2.importRecord.id).toBe(res1.importRecord.id);
  });

  it('ImportProcessor should process valid records and record rejections for invalid lines', async () => {
    const createUseCase = new CreateImportUseCase(importRepo, fileStorage, processor);
    const getStatusUseCase = new GetImportStatusUseCase(importRepo);
    const getRejectionsUseCase = new GetRejectionsUseCase(rejectionRepo, importRepo);

    const ndjsonContent = [
      JSON.stringify({
        transactionId: 'txn-1',
        accountId: 'acc-1',
        merchantId: 'mer-1',
        amount: 100,
        currency: 'USD',
        timestamp: '2026-07-20T10:00:00.000Z',
      }),
      '{"invalid_json":', // Malformed line
      JSON.stringify({
        transactionId: 'txn-2',
        accountId: 'acc-2',
        merchantId: 'mer-2',
        amount: -5, // Invalid amount
        currency: 'USD',
        timestamp: '2026-07-20T10:00:00.000Z',
      }),
    ].join('\n');

    const created = await createUseCase.execute({
      idempotencyKey: 'test-import-key-1',
      fileStream: Readable.from([ndjsonContent]),
    });

    const importId = created.importRecord.id;
    const filePath = Array.from(fileStorage.files.keys())[0];

    // Synchronously process for testing
    await processor.processImport(importId, filePath, 'default_provider');

    const status = await getStatusUseCase.execute(importId);
    expect(status.status).toBe('completed');
    expect(status.progress.processed).toBe(3);
    expect(status.progress.accepted).toBe(1);
    expect(status.progress.rejected).toBe(2);

    const rejections = await getRejectionsUseCase.execute(importId);
    expect(rejections.items.length).toBe(2);
    expect(rejections.items[0].reason).toBe('INVALID_JSON');
    expect(rejections.items[1].reason).toBe('INVALID_AMOUNT');
  });

  it('ImportProcessor should complete when a batch boundary falls after the stream ends', async () => {
    // Regression: the stream is delivered in one chunk, so readline has already
    // closed by the time the batch flush resolves.
    const smallBatchProcessor = new ImportProcessor(
      importRepo,
      transactionRepo,
      rejectionRepo,
      fileStorage,
      workerPool,
      { batchSize: 2 }
    );

    const ndjsonContent = [1, 2, 3]
      .map((n) =>
        JSON.stringify({
          transactionId: `txn-${n}`,
          accountId: 'acc-1',
          merchantId: 'mer-1',
          amount: 100,
          currency: 'USD',
          timestamp: '2026-07-20T10:00:00.000Z',
        })
      )
      .join('\n');

    const created = await new CreateImportUseCase(
      importRepo,
      fileStorage,
      smallBatchProcessor
    ).execute({
      idempotencyKey: 'test-batch-boundary-key',
      fileStream: Readable.from([ndjsonContent]),
    });

    const importId = created.importRecord.id;
    const filePath = Array.from(fileStorage.files.keys())[0];
    await smallBatchProcessor.processImport(importId, filePath, 'default_provider');

    const status = await new GetImportStatusUseCase(importRepo).execute(importId);
    expect(status.status).toBe('completed');
    expect(status.failureReason).toBeNull();
    expect(status.progress.accepted).toBe(3);
  });

  it('CancelImportUseCase should transition import status to cancelling', async () => {
    const createUseCase = new CreateImportUseCase(importRepo, fileStorage, processor);
    const cancelUseCase = new CancelImportUseCase(importRepo);

    const created = await createUseCase.execute({
      idempotencyKey: 'cancel-key-1',
      fileStream: Readable.from(['{"test":1}\n']),
    });

    const res = await cancelUseCase.execute(created.importRecord.id);
    expect(res.status).toBe('cancelling');
  });
});
