import { ILogger, silentLogger } from "../../domain/logging/logger.interface.js";

export interface ImportJob {
  importId: string;
  filePath: string;
  providerId: string;
}

export interface JobReservation {
  enqueue(job: ImportJob): void;
  release(): void;
}

export interface IImportJobQueue {
  reserve(): JobReservation | null;
  stopAccepting(): void;
  drain(): Promise<void>;
  readonly depth: number;
}

/** A bounded in-process queue. Jobs remain pending until a worker slot is free. */
export class ImportJobQueue implements IImportJobQueue {
  private queue: ImportJob[] = [];
  private active = 0;
  private reserved = 0;
  private accepting = true;
  private drainWaiters: Array<() => void> = [];

  constructor(
    private readonly process: (job: ImportJob) => Promise<void>,
    private readonly concurrency = 2,
    private readonly maxPending = 20,
    private readonly logger: ILogger = silentLogger,
  ) {}

  get depth(): number {
    return this.queue.length + this.reserved;
  }

  reserve(): JobReservation | null {
    if (!this.accepting || this.depth >= this.maxPending) return null;
    this.reserved++;
    let settled = false;
    const release = () => {
      if (!settled) {
        settled = true;
        this.reserved--;
        this.resolveDrainers();
      }
    };
    return {
      enqueue: (job) => {
        if (settled) throw new Error("Queue reservation was already released");
        release();
        this.queue.push(job);
        this.pump();
      },
      release,
    };
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  async drain(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0 && this.reserved === 0)
      return;
    await new Promise<void>((resolve) => this.drainWaiters.push(resolve));
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active++;
      void this.process(job)
        .catch((error) =>
          this.logger.error(
            { importId: job.importId, err: error, queueDepth: this.depth },
            "import_job_failed",
          ),
        )
        .finally(() => {
          this.active--;
          this.pump();
          this.resolveDrainers();
        });
    }
  }

  private resolveDrainers(): void {
    if (this.active !== 0 || this.queue.length !== 0 || this.reserved !== 0)
      return;
    for (const resolve of this.drainWaiters.splice(0)) resolve();
  }
}
