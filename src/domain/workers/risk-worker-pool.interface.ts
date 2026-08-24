import { RiskInput, RiskResult } from "../services/risk-scorer.js";

export interface IRiskWorkerPool {
  processBatch(items: RiskInput[]): Promise<RiskResult[]>;
  destroy(): Promise<void>;
}
