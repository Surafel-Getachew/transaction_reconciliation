import { Worker } from "node:worker_threads";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  RiskInput,
  RiskResult,
  RiskScorer,
} from "../../domain/services/risk-scorer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface IRiskWorkerPool {
  processBatch(items: RiskInput[]): Promise<RiskResult[]>;
  destroy(): Promise<void>;
}

// Tune per machine: CPU-bound scoring stops scaling past the fast physical cores.
const DEFAULT_POOL_SIZE = Math.max(
  1,
  parseInt(process.env.WORKER_CONCURRENCY || "4", 10) || 4,
);

export class RiskWorkerPool implements IRiskWorkerPool {
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private taskQueue: Array<{
    items: RiskInput[];
    resolve: (res: RiskResult[]) => void;
    reject: (err: any) => void;
  }> = [];
  private poolSize: number;

  constructor(poolSize?: number) {
    this.poolSize =
      poolSize && Number.isInteger(poolSize) && poolSize > 0
        ? poolSize
        : DEFAULT_POOL_SIZE;
    this.initWorkers();
  }

  private initWorkers() {
    let workerScript = path.join(__dirname, "risk-worker.js");
    let execArgv: string[] = [];

    if (!fs.existsSync(workerScript)) {
      const tsScript = path.join(__dirname, "risk-worker.ts");
      if (fs.existsSync(tsScript)) {
        workerScript = tsScript;
        execArgv = ["--import", "tsx"];
      } else {
        return; // Fallback to inline
      }
    }

    for (let i = 0; i < this.poolSize; i++) {
      try {
        const worker = new Worker(workerScript, { execArgv });
        this.workers.push(worker);
        this.idleWorkers.push(worker);
      } catch {
        // Fallback to inline execution if worker creation fails
      }
    }
  }

  async processBatch(items: RiskInput[]): Promise<RiskResult[]> {
    if (items.length === 0) return [];

    // Fallback if workers unavailable or disabled
    if (this.workers.length === 0) {
      return items.map((item) => RiskScorer.calculate(item));
    }

    // Spread one batch across the whole pool; a single task would leave every
    // other worker idle for the duration of the batch.
    const chunkSize = Math.ceil(items.length / this.workers.length);
    const chunks: RiskInput[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }

    const chunkResults = await Promise.all(
      chunks.map((chunk) => this.runTask(chunk)),
    );
    return chunkResults.flat();
  }

  private runTask(items: RiskInput[]): Promise<RiskResult[]> {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ items, resolve, reject });
      this.dispatch();
    });
  }

  private dispatch() {
    while (this.taskQueue.length > 0 && this.idleWorkers.length > 0) {
      this.assignNext();
    }
  }

  private assignNext() {
    const worker = this.idleWorkers.pop()!;
    const task = this.taskQueue.shift()!;

    const onMessage = (msg: any) => {
      cleanup();
      this.idleWorkers.push(worker);
      if (msg.success) {
        task.resolve(msg.results);
      } else {
        task.reject(new Error(msg.error));
      }
      this.dispatch();
    };

    const onError = (err: any) => {
      cleanup();
      const idx = this.workers.indexOf(worker);
      if (idx !== -1) this.workers.splice(idx, 1);
      task.reject(err);
      this.dispatch();
    };

    const cleanup = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
    };

    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.postMessage(task.items);
  }

  async destroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
    this.idleWorkers = [];
  }
}
