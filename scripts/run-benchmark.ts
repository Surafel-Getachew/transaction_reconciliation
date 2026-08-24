import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const TEST_FILE = './benchmark_dataset.ndjson';

function parseRecordsArg(): number {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--records=')) {
      return parseInt(arg.split('=')[1], 10) || 10000;
    }
  }
  return 10000;
}

function generateBenchmarkData(recordCount: number): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`Generating ${recordCount} records for benchmark dataset...`);
    const writeStream = fs.createWriteStream(TEST_FILE, { encoding: 'utf-8' });

    for (let i = 1; i <= recordCount; i++) {
      const record = {
        transactionId: `bm-txn-${i}`,
        accountId: `bm-acc-${i % 50}`,
        merchantId: `bm-merchant-${i % 20}`,
        amount: parseFloat((Math.random() * 500 + 10).toFixed(2)),
        currency: i % 3 === 0 ? 'EUR' : 'USD',
        timestamp: new Date().toISOString(),
        description: `Benchmark test transaction ${i}`,
      };
      writeStream.write(JSON.stringify(record) + '\n');
    }

    writeStream.end();
    writeStream.on('finish', () => resolve(TEST_FILE));
    writeStream.on('error', reject);
  });
}

async function runBenchmark() {
  const recordCount = parseRecordsArg();
  await generateBenchmarkData(recordCount);

  console.log('\n--- Starting Performance Benchmark ---');
  const idempotencyKey = `bm-key-${Date.now()}`;

  const fileBuf = fs.readFileSync(TEST_FILE);
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="benchmark_dataset.ndjson"\r\nContent-Type: application/x-ndjson\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(header, 'utf-8'),
    fileBuf,
    Buffer.from(footer, 'utf-8'),
  ]);

  const startTime = performance.now();

  // 1. Submit import job
  const uploadRes = await fetch(`${API_BASE}/v1/imports`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
      'X-Provider-Id': 'benchmark_provider',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    console.error('Benchmark upload failed:', uploadRes.status, errText);
    process.exit(1);
  }

  const uploadJson = (await uploadRes.json()) as { id: string; status: string };
  const importId = uploadJson.id;
  console.log(`Import created with ID: ${importId}. Status: ${uploadJson.status}`);

  // 2. Concurrently poll status and health while import is processing
  const apiLatencies: number[] = [];
  let isDone = false;
  let statusResult: any;
  let peakRssMb = 0;
  let peakHeapMb = 0;
  let peakLoopDelayMs = 0;
  let peakLoopUtilization = 0;

  // some series carry labels, e.g. process_event_loop_delay_ms{quantile="0.99"}
  const readGauge = (text: string, series: string): number => {
    const match = text.match(
      new RegExp(`^${series.replace(/[{}"".]/g, (c) => '\\' + c)} ([0-9.eE+-]+)$`, 'm')
    );
    return match ? parseFloat(match[1]) : 0;
  };

  while (!isDone) {
    const pollStart = performance.now();
    const statusRes = await fetch(`${API_BASE}/v1/imports/${importId}`);
    const pollDuration = performance.now() - pollStart;
    apiLatencies.push(pollDuration);

    if (statusRes.ok) {
      statusResult = await statusRes.json();
      if (statusResult.status === 'completed' || statusResult.status === 'failed') {
        isDone = true;
      }
    }
    const sample = await (await fetch(`${API_BASE}/metrics`)).text();
    peakRssMb = Math.max(peakRssMb, readGauge(sample, 'process_resident_memory_bytes') / 1048576);
    peakHeapMb = Math.max(peakHeapMb, readGauge(sample, 'process_heap_used_bytes') / 1048576);
    peakLoopDelayMs = Math.max(peakLoopDelayMs, readGauge(sample, 'process_event_loop_delay_ms{quantile="0.99"}'));
    peakLoopUtilization = Math.max(peakLoopUtilization, readGauge(sample, 'process_event_loop_utilization'));

    await new Promise((r) => setTimeout(r, 100));
  }

  const endTime = performance.now();
  const totalDurationSec = (endTime - startTime) / 1000;
  const throughput = recordCount / totalDurationSec;

  apiLatencies.sort((a, b) => a - b);
  const p50Latency = apiLatencies[Math.floor(apiLatencies.length * 0.5)] || 0;
  const p99Latency = apiLatencies[Math.floor(apiLatencies.length * 0.99)] || 0;

  console.log('\n========================================');
  console.log('         BENCHMARK RESULTS REPORT       ');
  console.log('========================================');
  console.log(`Dataset Size:             ${recordCount.toLocaleString()} records`);
  console.log(`Total Processing Duration: ${totalDurationSec.toFixed(2)} seconds`);
  console.log(`Average Throughput:        ${throughput.toFixed(2)} records/sec`);
  console.log(`API Latency (P50):         ${p50Latency.toFixed(2)} ms`);
  console.log(`API Latency (P99):         ${p99Latency.toFixed(2)} ms`);
  console.log(`Processed:                ${statusResult.progress.processed}`);
  console.log(`Accepted:                 ${statusResult.progress.accepted}`);
  console.log(`Rejected:                 ${statusResult.progress.rejected}`);
  console.log(`Duplicates:               ${statusResult.progress.duplicates}`);
  console.log(`Peak RSS:                 ${peakRssMb.toFixed(0)} MB`);
  console.log(`Peak Heap Used:           ${peakHeapMb.toFixed(0)} MB`);
  console.log(`Event-Loop Delay P99:     ${peakLoopDelayMs.toFixed(2)} ms`);
  console.log(`Event-Loop Utilization:   ${peakLoopUtilization.toFixed(2)} %`);
  console.log(`Worker Concurrency:       ${process.env.WORKER_CONCURRENCY || '4 (default)'}`);
  console.log(`DB Batch Size:            ${process.env.BATCH_SIZE || '1000 (default)'}`);
  console.log(`CPU Cores:                ${os.cpus().length} (${os.arch()})`);
  console.log(`Total System Memory:      ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log('========================================\n');

  try {
    fs.unlinkSync(TEST_FILE);
  } catch {}
}

runBenchmark().catch((err) => {
  console.error('Benchmark execution error:', err);
  process.exit(1);
});
