import { eq, inArray } from 'drizzle-orm';
import { Database } from '../db/index.js';
import { imports } from '../db/schema/imports.js';

export class JobRecoveryService {
  constructor(private db: Database) {}

  async recoverStaleJobs(): Promise<number> {
    const staleJobs = await this.db
      .select({ id: imports.id, status: imports.status })
      .from(imports)
      .where(inArray(imports.status, ['processing', 'cancelling']));

    if (staleJobs.length === 0) {
      return 0;
    }

    console.log(`Found ${staleJobs.length} stale job(s) from previous run. Recovering...`);

    for (const job of staleJobs) {
      const newStatus = job.status === 'cancelling' ? 'cancelled' : 'failed';
      await this.db
        .update(imports)
        .set({
          status: newStatus,
          completedAt: new Date(),
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
