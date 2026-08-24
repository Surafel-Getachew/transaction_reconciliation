import { NewTransaction } from "../entities/transaction.entity.js";

export interface CurrencySummary {
  currency: string;
  transactionCount: number;
  totalAmount: number;
}

export interface RiskLevelSummary {
  low: number;
  medium: number;
  high: number;
}

export interface GroupSummary {
  id: string;
  transactionCount: number;
  totalAmount: number;
}

export interface ReconciliationSummary {
  importId: string;
  totals: {
    accepted: number;
    rejected: number;
    duplicates: number;
  };
  byCurrency: CurrencySummary[];
  byRiskLevel: RiskLevelSummary;
  byMerchant: GroupSummary[];
  byAccount: GroupSummary[];
}

export interface ITransactionRepository {
  batchInsert(
    records: NewTransaction[],
  ): Promise<{ insertedCount: number; duplicateCount: number }>;
  getSummaryByImportId(importId: string): Promise<ReconciliationSummary | null>;
}
