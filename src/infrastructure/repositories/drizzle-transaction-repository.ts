import { eq, sql } from "drizzle-orm";
import { Database } from "../db/index.js";
import { transactions } from "../db/schema/transactions.js";
import { NewTransaction } from "../../domain/entities/transaction.entity.js";
import { toTransactionRow } from "./mappers.js";
import { imports } from "../db/schema/imports.js";
import {
  ITransactionRepository,
  ReconciliationSummary,
} from "../../domain/repositories/transaction-repository.interface.js";

const SUMMARY_TOP_N = 100;

export class DrizzleTransactionRepository implements ITransactionRepository {
  constructor(private db: Database) {}

  async batchInsert(
    records: NewTransaction[],
  ): Promise<{ insertedCount: number; duplicateCount: number }> {
    if (records.length === 0) {
      return { insertedCount: 0, duplicateCount: 0 };
    }

    const insertedRows = await this.db
      .insert(transactions)
      .values(records.map(toTransactionRow))
      .onConflictDoNothing({
        target: [transactions.providerId, transactions.transactionId],
      })
      .returning({ id: transactions.id });

    const insertedCount = insertedRows.length;
    const duplicateCount = records.length - insertedCount;

    return { insertedCount, duplicateCount };
  }

  async getSummaryByImportId(
    importId: string,
  ): Promise<ReconciliationSummary | null> {
    const importRes = await this.db
      .select()
      .from(imports)
      .where(eq(imports.id, importId))
      .limit(1);
    if (importRes.length === 0) {
      return null;
    }
    const imp = importRes[0];

    // Currency aggregation
    const currencyRes = await this.db
      .select({
        currency: transactions.currency,
        transactionCount: sql<number>`count(*)::int`,
        totalAmount: sql<number>`sum(${transactions.amount})::float`,
      })
      .from(transactions)
      .where(eq(transactions.importId, importId))
      .groupBy(transactions.currency);

    // Risk level aggregation
    const riskRes = await this.db
      .select({
        riskLevel: transactions.riskLevel,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(eq(transactions.importId, importId))
      .groupBy(transactions.riskLevel);

    // Merchant aggregation
    const merchantRes = await this.db
      .select({
        merchantId: transactions.merchantId,
        transactionCount: sql<number>`count(*)::int`,
        totalAmount: sql<number>`sum(${transactions.amount})::float`,
      })
      .from(transactions)
      .where(eq(transactions.importId, importId))
      .groupBy(transactions.merchantId)
      .orderBy(
        sql`sum(${transactions.amount}) DESC`,
        sql`count(*) DESC`,
        transactions.merchantId,
      )
      .limit(SUMMARY_TOP_N);

    // Account aggregation
    const accountRes = await this.db
      .select({
        accountId: transactions.accountId,
        transactionCount: sql<number>`count(*)::int`,
        totalAmount: sql<number>`sum(${transactions.amount})::float`,
      })
      .from(transactions)
      .where(eq(transactions.importId, importId))
      .groupBy(transactions.accountId)
      .orderBy(
        sql`sum(${transactions.amount}) DESC`,
        sql`count(*) DESC`,
        transactions.accountId,
      )
      .limit(SUMMARY_TOP_N);

    const byRiskLevel = {
      low: 0,
      medium: 0,
      high: 0,
    };

    for (const r of riskRes) {
      if (r.riskLevel === "low") byRiskLevel.low = r.count;
      else if (r.riskLevel === "medium") byRiskLevel.medium = r.count;
      else if (r.riskLevel === "high") byRiskLevel.high = r.count;
    }

    return {
      importId,
      totals: {
        accepted: imp.acceptedCount,
        rejected: imp.rejectedCount,
        duplicates: imp.duplicateCount,
      },
      byCurrency: currencyRes.map((c) => ({
        currency: c.currency,
        transactionCount: c.transactionCount,
        totalAmount: Number(c.totalAmount || 0),
      })),
      byRiskLevel,
      byMerchant: merchantRes.map((m) => ({
        id: m.merchantId,
        transactionCount: m.transactionCount,
        totalAmount: Number(m.totalAmount || 0),
      })),
      byAccount: accountRes.map((a) => ({
        id: a.accountId,
        transactionCount: a.transactionCount,
        totalAmount: Number(a.totalAmount || 0),
      })),
    };
  }
}
