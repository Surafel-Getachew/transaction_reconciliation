import { and, eq, inArray, lt, or, isNull } from 'drizzle-orm';
import { Database } from '../db/index.js';
import { imports } from '../db/schema/imports.js';
import { ILogger, silentLogger } from '../../domain/logging/logger.interface.js';

export class JobRecoveryService {
  constructor(
    private db: Database,
    private logger: ILogger = silentLogger,
  ) {}

  async recoverStaleJobs(): Promise<number> {
    // Only imports whose lease has lapsed are abandoned. An import still being
    // processed by a live instance keeps renewing its lease on every batch, so
    // starting a second instance leaves it alone.
    const staleJobs = await this.db
      .select({ id: imports.id, status: imports.status, ownerId: imports.ownerId })
      .from(imports)
      .where(
        and(
          inArray(imports.status, ['processing', 'cancelling']),
          or(
            isNull(imports.leaseExpiresAt),
            lt(imports.leaseExpiresAt, new Date()),
          ),
        ),
      );

    if (staleJobs.length === 0) {
      return 0;
    }

    this.logger.warn({ staleJobCount: staleJobs.length }, 'stale_jobs_recovering');

    for (const job of staleJobs) {
      const newStatus = job.status === 'cancelling' ? 'cancelled' : 'failed';
      await this.db
        .update(imports)
        .set({
          status: newStatus,
          completedAt: new Date(),
          ownerId: null,
          leaseExpiresAt: null,
          failureReason:
            newStatus === 'cancelled'
              ? 'Job cancelled prior to system restart'
              : 'Job interrupted due to unexpected process restart/crash',
        })
        .where(eq(imports.id, job.id));
    }

    return staleJobs.length;
  }
}
