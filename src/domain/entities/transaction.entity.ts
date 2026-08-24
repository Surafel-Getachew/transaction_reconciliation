export type RiskLevel = "low" | "medium" | "high";

/** A scored, normalized transaction ready to be persisted. */
export interface NewTransaction {
  id: string;
  importId: string;
  providerId: string;
  transactionId: string;
  accountId: string;
  merchantId: string;
  amount: number;
  currency: string;
  timestamp: Date;
  description: string | null;
  fingerprint: string;
  riskScore: number;
  riskLevel: RiskLevel;
}
