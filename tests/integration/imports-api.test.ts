import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { db, pool } from '../../src/infrastructure/db/index.js';
import { DrizzleImportRepository } from '../../src/infrastructure/repositories/drizzle-import-repository.js';
import { DrizzleTransactionRepository } from '../../src/infrastructure/repositories/drizzle-transaction-repository.js';
import { DrizzleRejectionRepository } from '../../src/infrastructure/repositories/drizzle-rejection-repository.js';
import { DrizzleImportBatchPersister } from '../../src/infrastructure/repositories/drizzle-import-batch-persister.js';
import { LocalFileStorage } from '../../src/infrastructure/storage/local-file-storage.js';
import { RiskWorkerPool } from '../../src/infrastructure/workers/worker-pool.js';
import { ImportProcessor } from '../../src/application/processor/import-processor.js';
import { CreateImportUseCase } from '../../src/application/use-cases/create-import.usecase.js';
import { GetImportStatusUseCase } from '../../src/application/use-cases/get-import-status.usecase.js';
import { CancelImportUseCase } from '../../src/application/use-cases/cancel-import.usecase.js';
import { GetSummaryUseCase } from '../../src/application/use-cases/get-summary.usecase.js';
import { GetRejectionsUseCase } from '../../src/application/use-cases/get-rejections.usecase.js';
import { ImportController } from '../../src/presentation/http/controllers/import.controller.js';
import { createRouter } from '../../src/presentation/http/routes.js';
import { createApp } from '../../src/presentation/server.js';
import { runMigrations } from '../../src/infrastructure/db/migrate.js';
import { MetricsMonitor } from '../../src/infrastructure/metrics/metrics-monitor.js';
import { JobRecoveryService } from '../../src/infrastructure/recovery/job-recovery.js';
import { imports, transactions, rejections, idempotencyKeys } from '../../src/infrastructure/db/schema/index.js';
import { eq } from 'drizzle-orm';

describe('Import & Reconciliation API Integration Tests', () => {
  let app: any;
  let workerPool: RiskWorkerPool;

  beforeAll(async () => {
    await runMigrations();

    // Clean tables
    await db.delete(transactions);
    await db.delete(rejections);
    await db.delete(idempotencyKeys);
    await db.delete(imports);

    const importRepo = new DrizzleImportRepository(db);
    const transactionRepo = new DrizzleTransactionRepository(db);
    const rejectionRepo = new DrizzleRejectionRepository(db);
    const batchPersister = new DrizzleImportBatchPersister(db);
    const fileStorage = new LocalFileStorage('./uploads_test');
    workerPool = new RiskWorkerPool(1);

    const processor = new ImportProcessor(
      importRepo,
      transactionRepo,
      rejectionRepo,
      fileStorage,
      workerPool,
      { batchSize: 10 },
      batchPersister,
    );

    const createImportUseCase = new CreateImportUseCase(importRepo, fileStorage, processor);
    const getImportStatusUseCase = new GetImportStatusUseCase(importRepo);
    const cancelImportUseCase = new CancelImportUseCase(importRepo);
    const getSummaryUseCase = new GetSummaryUseCase(transactionRepo);
    const getRejectionsUseCase = new GetRejectionsUseCase(rejectionRepo, importRepo);

    const controller = new ImportController(
      createImportUseCase,
      getImportStatusUseCase,
      cancelImportUseCase,
      getSummaryUseCase,
      getRejectionsUseCase,
      () => true,
      MetricsMonitor.getInstance(),
      async () => {
        await pool.query('SELECT 1');
        return true;
      }
    );

    const router = createRouter(controller);
    app = createApp(router);
  });

  afterAll(async () => {
    await workerPool?.destroy();
    await pool.end();
  });

  it('GET /health/live and GET /health/ready should return 200', async () => {
    const resLive = await request(app).get('/health/live');
    expect(resLive.status).toBe(200);
    expect(resLive.body.status).toBe('live');

    const resReady = await request(app).get('/health/ready');
    expect(resReady.status).toBe(200);
    expect(resReady.body.status).toBe('ready');
  });

  it('POST /v1/imports without Idempotency-Key should return 400', async () => {
    const res = await request(app).post('/v1/imports');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('POST /v1/imports with valid NDJSON file should create import and process asynchronously', async () => {
    const key = `idem-integration-${Date.now()}`;
    const fileContent = [
      JSON.stringify({
        transactionId: 'tx-integ-1',
        accountId: 'acc-1',
        merchantId: 'mer-1',
        amount: 250.5,
        currency: 'USD',
        timestamp: '2026-07-20T10:00:00.000Z',
        description: 'Valid record 1',
      }),
      JSON.stringify({
        transactionId: 'tx-integ-2',
        accountId: 'acc-2',
        merchantId: 'mer-1',
        amount: 50.0,
        currency: 'EUR',
        timestamp: '2026-07-20T11:00:00.000Z',
        description: 'Valid record 2',
      }),
      '{"invalid_json":', // Line 3: malformed JSON
    ].join('\n');

    const res = await request(app)
      .post('/v1/imports')
      .set('Idempotency-Key', key)
      .set('X-Provider-Id', 'provider_1')
      .attach('file', Buffer.from(fileContent), 'test.ndjson');

    expect(res.status).toBe(202);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('pending');

    const importId = res.body.id;

    // Poll status until completion
    let attempts = 0;
    let finalStatus: any;
    while (attempts < 20) {
      await new Promise((r) => setTimeout(r, 200));
      const statusRes = await request(app).get(`/v1/imports/${importId}`);
      if (statusRes.body.status === 'completed' || statusRes.body.status === 'failed') {
        finalStatus = statusRes.body;
        break;
      }
      attempts++;
    }

    expect(finalStatus.status).toBe('completed');
    expect(finalStatus.progress.processed).toBe(3);
    expect(finalStatus.progress.accepted).toBe(2);
    expect(finalStatus.progress.rejected).toBe(1);

    // Verify reconciliation summary
    const summaryRes = await request(app).get(`/v1/imports/${importId}/summary`);
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.totals.accepted).toBe(2);
    expect(summaryRes.body.totals.rejected).toBe(1);
    expect(summaryRes.body.byCurrency.length).toBe(2);
    // merchant/account breakdowns are capped top-N, ranked by total amount
    expect(summaryRes.body.byMerchant.length).toBe(1);
    expect(summaryRes.body.byAccount.length).toBe(2);
    expect(summaryRes.body.byAccount[0].totalAmount).toBeGreaterThanOrEqual(
      summaryRes.body.byAccount[1].totalAmount
    );

    // Verify rejections pagination
    const rejectionsRes = await request(app).get(`/v1/imports/${importId}/rejections?limit=10`);
    expect(rejectionsRes.status).toBe(200);
    expect(rejectionsRes.body.items.length).toBe(1);
    expect(rejectionsRes.body.items[0].lineNumber).toBe(3);
    expect(rejectionsRes.body.items[0].reason).toBe('INVALID_JSON');
  });

  it('POST /v1/imports with repeated Idempotency-Key should return existing import without duplicate processing', async () => {
    const key = `idem-repeat-${Date.now()}`;
    const fileContent = JSON.stringify({
      transactionId: 'tx-repeat-1',
      accountId: 'acc-1',
      merchantId: 'mer-1',
      amount: 100,
      currency: 'USD',
      timestamp: '2026-07-20T10:00:00.000Z',
    }) + '\n';

    const res1 = await request(app)
      .post('/v1/imports')
      .set('Idempotency-Key', key)
      .attach('file', Buffer.from(fileContent), 'test.ndjson');

    expect(res1.status).toBe(202);

    const res2 = await request(app)
      .post('/v1/imports')
      .set('Idempotency-Key', key)
      .attach('file', Buffer.from(fileContent), 'test.ndjson');

    expect(res2.status).toBe(202);
    expect(res2.body.id).toBe(res1.body.id);
  });

  it('handles concurrent requests with the same idempotency key atomically', async () => {
    const key = `idem-concurrent-${Date.now()}`;
    const fileContent = JSON.stringify({
      transactionId: `tx-concurrent-${Date.now()}`,
      accountId: 'acc-1', merchantId: 'mer-1', amount: 100, currency: 'USD',
      timestamp: '2026-07-20T10:00:00.000Z',
    }) + '\n';

    const responses = await Promise.all(Array.from({ length: 8 }, () =>
      request(app).post('/v1/imports').set('Idempotency-Key', key)
        .attach('file', Buffer.from(fileContent), 'test.ndjson')
    ));

    expect(responses.every((response) => response.status === 202)).toBe(true);
    expect(new Set(responses.map((response) => response.body.id)).size).toBe(1);
  });


  it('handles a transaction id repeated within a single file', async () => {
    const repeatedId = `tx-in-file-${Date.now()}`;
    const record = (over: object) => ({
      transactionId: repeatedId,
      accountId: 'acc-1',
      merchantId: 'mer-1',
      amount: 100,
      currency: 'USD',
      timestamp: '2026-07-20T10:00:00.000Z',
      ...over,
    });

    // one accepted, one identical repeat, one repeat with different content
    const file = [
      record({}),
      record({}),
      record({ amount: 999999, accountId: 'acc-other' }),
    ]
      .map((r) => JSON.stringify(r))
      .join('\n');

    const res = await request(app)
      .post('/v1/imports')
      .set('Idempotency-Key', `in-file-${Date.now()}`)
      .set('X-Provider-Id', 'in-file-provider')
      .attach('file', Buffer.from(file + '\n'), 'repeat.ndjson');
    expect(res.status).toBe(202);

    let status: any;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const poll = await request(app).get(`/v1/imports/${res.body.id}`);
      if (['completed', 'failed'].includes(poll.body.status)) {
        status = poll.body;
        break;
      }
    }

    expect(status.status).toBe('completed');
    expect(status.progress.accepted).toBe(1);
    expect(status.progress.duplicates).toBe(1);
    expect(status.progress.rejected).toBe(1);
    // every submitted record lands in exactly one bucket
    expect(
      status.progress.accepted + status.progress.rejected + status.progress.duplicates
    ).toBe(status.progress.processed);

    const rejections = await request(app).get(`/v1/imports/${res.body.id}/rejections`);
    expect(rejections.body.items).toHaveLength(1);
    expect(rejections.body.items[0].reason).toBe('DUPLICATE_CONTENT_MISMATCH');
    expect(rejections.body.items[0].lineNumber).toBe(3);
  });

  it('records a rejection when a duplicate transaction id carries different content', async () => {
    const sharedTxnId = `tx-conflict-${Date.now()}`;
    const original = {
      transactionId: sharedTxnId,
      accountId: 'acc-original',
      merchantId: 'mer-original',
      amount: 100,
      currency: 'USD',
      timestamp: '2026-07-20T10:00:00.000Z',
    };
    // same id, entirely different content — first write must win, visibly
    const conflicting = {
      ...original,
      accountId: 'acc-attacker',
      merchantId: 'mer-attacker',
      amount: 999999,
      currency: 'JPY',
    };

    const upload = async (key: string, record: object) => {
      const res = await request(app)
        .post('/v1/imports')
        .set('Idempotency-Key', key)
        .set('X-Provider-Id', 'conflict-provider')
        .attach('file', Buffer.from(JSON.stringify(record) + '\n'), 'c.ndjson');
      expect(res.status).toBe(202);
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const status = await request(app).get(`/v1/imports/${res.body.id}`);
        if (['completed', 'failed'].includes(status.body.status)) return status.body;
      }
      throw new Error('import did not settle');
    };

    const first = await upload(`conflict-a-${Date.now()}`, original);
    expect(first.progress.accepted).toBe(1);

    const second = await upload(`conflict-b-${Date.now()}`, conflicting);
    expect(second.progress.accepted).toBe(0);
    // counted as rejected rather than silently swallowed as a duplicate
    expect(second.progress.rejected).toBe(1);
    expect(second.progress.duplicates).toBe(0);
    expect(
      second.progress.accepted + second.progress.rejected + second.progress.duplicates
    ).toBe(second.progress.processed);

    const rejections = await request(app).get(`/v1/imports/${second.id}/rejections`);
    expect(rejections.body.items).toHaveLength(1);
    expect(rejections.body.items[0].reason).toBe('DUPLICATE_CONTENT_MISMATCH');
    expect(rejections.body.items[0].lineNumber).toBe(1);
    expect(rejections.body.items[0].rawValue.transactionId).toBe(sharedTxnId);

    // first write wins: the stored row is untouched
    const [stored] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionId, sharedTxnId));
    expect(stored.accountId).toBe('acc-original');
    expect(stored.currency).toBe('USD');
  });

  it('treats an identical re-submission as a duplicate, not a conflict', async () => {
    const record = {
      transactionId: `tx-replay-${Date.now()}`,
      accountId: 'acc-1',
      merchantId: 'mer-1',
      amount: 42.5,
      currency: 'USD',
      timestamp: '2026-07-20T10:00:00.000Z',
    };

    const upload = async (key: string) => {
      const res = await request(app)
        .post('/v1/imports')
        .set('Idempotency-Key', key)
        .set('X-Provider-Id', 'replay-provider')
        .attach('file', Buffer.from(JSON.stringify(record) + '\n'), 'r.ndjson');
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const status = await request(app).get(`/v1/imports/${res.body.id}`);
        if (['completed', 'failed'].includes(status.body.status)) return status.body;
      }
      throw new Error('import did not settle');
    };

    await upload(`replay-a-${Date.now()}`);
    const second = await upload(`replay-b-${Date.now()}`);

    expect(second.progress.duplicates).toBe(1);
    expect(second.progress.rejected).toBe(0);
  });

  it('job recovery reclaims only imports whose lease has expired', async () => {
    const replicaA = new DrizzleImportRepository(db, {
      ownerId: 'replica-a',
      leaseTtlMs: 60_000,
    });
    const recovery = new JobRecoveryService(db);

    for (const id of ['lease-live', 'lease-abandoned']) {
      await replicaA.createWithIdempotency(
        { id, providerId: 'lease-provider', status: 'pending' },
        `lease-key-${id}`
      );
      await replicaA.markStarted(id);
    }

    // Only the abandoned import's owner stopped renewing its lease.
    await db
      .update(imports)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(imports.id, 'lease-abandoned'));

    // A second replica booting must not disturb the import still being worked on.
    const reclaimed = await recovery.recoverStaleJobs();
    expect(reclaimed).toBe(1);

    const live = await replicaA.findById('lease-live');
    expect(live?.status).toBe('processing');
    expect(live?.ownerId).toBe('replica-a');

    const abandoned = await replicaA.findById('lease-abandoned');
    expect(abandoned?.status).toBe('failed');
    expect(abandoned?.ownerId).toBeNull();

    // Re-claiming a previously failed import counts as another attempt.
    await replicaA.markStarted('lease-abandoned');
    expect((await replicaA.findById('lease-abandoned'))?.attempts).toBe(2);
  });
});
