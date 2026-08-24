import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { IMetricsRecorder } from '../../domain/metrics/metrics-recorder.interface.js';

export class MetricsMonitor implements IMetricsRecorder {
  private static instance: MetricsMonitor;
  private histogram: ReturnType<typeof monitorEventLoopDelay>;
  private lastElu: ReturnType<typeof performance.eventLoopUtilization>;

  // Metrics counters
  private activeImports = 0;
  private queueDepth = 0;
  private totalHttpRequests = 0;
  private httpRequestsByStatus: Record<number, number> = {};
  private totalRecordsProcessed = 0;
  private totalRecordsAccepted = 0;
  private totalRecordsRejected = 0;
  private totalRecordsDuplicates = 0;
  private totalRetryAttempts = 0;

  private constructor() {
    this.histogram = monitorEventLoopDelay({ resolution: 10 });
    this.histogram.enable();
    this.lastElu = performance.eventLoopUtilization();
  }

  public static getInstance(): MetricsMonitor {
    if (!MetricsMonitor.instance) {
      MetricsMonitor.instance = new MetricsMonitor();
    }
    return MetricsMonitor.instance;
  }

  // Counter mutators
  public incrementActiveImports() {
    this.activeImports++;
  }

  public decrementActiveImports() {
    this.activeImports = Math.max(0, this.activeImports - 1);
  }

  public setQueueDepth(depth: number) {
    this.queueDepth = Math.max(0, depth);
  }

  public recordHttpRequest(statusCode: number) {
    this.totalHttpRequests++;
    this.httpRequestsByStatus[statusCode] = (this.httpRequestsByStatus[statusCode] || 0) + 1;
  }

  public recordProcessedBatch(processed: number, accepted: number, rejected: number, duplicates: number) {
    this.totalRecordsProcessed += processed;
    this.totalRecordsAccepted += accepted;
    this.totalRecordsRejected += rejected;
    this.totalRecordsDuplicates += duplicates;
  }

  public incrementRetryAttempts() {
    this.totalRetryAttempts++;
  }

  // Getters for status & monitoring
  public getMetricsSummary() {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const currentElu = performance.eventLoopUtilization(this.lastElu);

    const minDelayMs = this.histogram.min / 1e6;
    const maxDelayMs = this.histogram.max / 1e6;
    const meanDelayMs = this.histogram.mean / 1e6;
    const p50DelayMs = this.histogram.percentile(50) / 1e6;
    const p99DelayMs = this.histogram.percentile(99) / 1e6;

    return {
      eventLoop: {
        minDelayMs: isNaN(minDelayMs) ? 0 : minDelayMs,
        maxDelayMs: isNaN(maxDelayMs) ? 0 : maxDelayMs,
        meanDelayMs: isNaN(meanDelayMs) ? 0 : meanDelayMs,
        p50DelayMs: isNaN(p50DelayMs) ? 0 : p50DelayMs,
        p99DelayMs: isNaN(p99DelayMs) ? 0 : p99DelayMs,
        utilizationPct: (currentElu.utilization * 100).toFixed(2),
      },
      memory: {
        rssBytes: mem.rss,
        heapTotalBytes: mem.heapTotal,
        heapUsedBytes: mem.heapUsed,
        externalBytes: mem.external,
      },
      cpu: {
        userMicros: cpu.user,
        systemMicros: cpu.system,
      },
      app: {
        activeImports: this.activeImports,
        queueDepth: this.queueDepth,
        totalHttpRequests: this.totalHttpRequests,
        totalRecordsProcessed: this.totalRecordsProcessed,
        totalRecordsAccepted: this.totalRecordsAccepted,
        totalRecordsRejected: this.totalRecordsRejected,
        totalRecordsDuplicates: this.totalRecordsDuplicates,
        totalRetryAttempts: this.totalRetryAttempts,
      },
    };
  }

  public formatPrometheusMetrics(): string {
    const summary = this.getMetricsSummary();

    const lines: string[] = [
      '# HELP process_event_loop_delay_ms Event loop delay in milliseconds',
      '# TYPE process_event_loop_delay_ms gauge',
      `process_event_loop_delay_ms{quantile="0.5"} ${summary.eventLoop.p50DelayMs.toFixed(3)}`,
      `process_event_loop_delay_ms{quantile="0.99"} ${summary.eventLoop.p99DelayMs.toFixed(3)}`,
      `process_event_loop_delay_ms{stat="mean"} ${summary.eventLoop.meanDelayMs.toFixed(3)}`,

      '# HELP process_event_loop_utilization Event loop utilization ratio',
      '# TYPE process_event_loop_utilization gauge',
      `process_event_loop_utilization ${summary.eventLoop.utilizationPct}`,

      '# HELP process_resident_memory_bytes Resident memory size in bytes',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${summary.memory.rssBytes}`,

      '# HELP process_heap_used_bytes Heap used in bytes',
      '# TYPE process_heap_used_bytes gauge',
      `process_heap_used_bytes ${summary.memory.heapUsedBytes}`,

      '# HELP app_active_imports Number of currently processing imports',
      '# TYPE app_active_imports gauge',
      `app_active_imports ${summary.app.activeImports}`,

      '# HELP app_processing_queue_depth Pending processing batch queue depth',
      '# TYPE app_processing_queue_depth gauge',
      `app_processing_queue_depth ${summary.app.queueDepth}`,

      '# HELP app_records_processed_total Total transaction records parsed and processed',
      '# TYPE app_records_processed_total counter',
      `app_records_processed_total ${summary.app.totalRecordsProcessed}`,

      '# HELP app_records_accepted_total Total valid transaction records persisted',
      '# TYPE app_records_accepted_total counter',
      `app_records_accepted_total ${summary.app.totalRecordsAccepted}`,

      '# HELP app_records_rejected_total Total malformed or invalid transaction records',
      '# TYPE app_records_rejected_total counter',
      `app_records_rejected_total ${summary.app.totalRecordsRejected}`,

      '# HELP app_records_duplicates_total Total duplicate transactions detected',
      '# TYPE app_records_duplicates_total counter',
      `app_records_duplicates_total ${summary.app.totalRecordsDuplicates}`,

      '# HELP app_retry_attempts_total Total operation retry attempts',
      '# TYPE app_retry_attempts_total counter',
      `app_retry_attempts_total ${summary.app.totalRetryAttempts}`,

      '# HELP http_requests_total Total HTTP requests handled',
      '# TYPE http_requests_total counter',
      `http_requests_total ${summary.app.totalHttpRequests}`,
    ];

    for (const [status, count] of Object.entries(this.httpRequestsByStatus)) {
      lines.push(`http_requests_by_status{code="${status}"} ${count}`);
    }

    return lines.join('\n') + '\n';
  }
}
