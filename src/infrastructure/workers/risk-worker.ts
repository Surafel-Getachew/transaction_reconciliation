import { parentPort } from 'node:worker_threads';
import { RiskScorer, RiskInput } from '../../domain/services/risk-scorer.js';

if (parentPort) {
  parentPort.on('message', (items: RiskInput[]) => {
    try {
      const results = items.map((item) => RiskScorer.calculate(item));
      parentPort?.postMessage({ success: true, results });
    } catch (err: any) {
      parentPort?.postMessage({ success: false, error: err?.message || 'Worker error' });
    }
  });
}
