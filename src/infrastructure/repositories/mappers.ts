import {
  ImportRecord,
  ImportStatus,
} from "../../domain/entities/import.entity.js";
import { NewRejection } from "../../domain/entities/rejection.entity.js";
import {
  NewTransaction,
  RiskLevel,
} from "../../domain/entities/transaction.entity.js";
import { NewRejectionRecord } from "../db/schema/rejections.js";
import { NewTransactionRecord } from "../db/schema/transactions.js";
import { ImportRecord as ImportRow } from "../db/schema/imports.js";

/** Numeric columns come back as strings from node-postgres to preserve precision. */
export function toImportRecord(row: ImportRow): ImportRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    status: row.status as ImportStatus,
    processedCount: row.processedCount,
    acceptedCount: row.acceptedCount,
    rejectedCount: row.rejectedCount,
    duplicateCount: row.duplicateCount,
    failureReason: row.failureReason,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    ownerId: row.ownerId,
    leaseExpiresAt: row.leaseExpiresAt,
    attempts: row.attempts,
  };
}

export function toTransactionRow(
  transaction: NewTransaction,
): NewTransactionRecord {
  return {
    id: transaction.id,
    importId: transaction.importId,
    providerId: transaction.providerId,
    transactionId: transaction.transactionId,
    accountId: transaction.accountId,
    merchantId: transaction.merchantId,
    amount: transaction.amount.toFixed(2),
    currency: transaction.currency,
    timestamp: transaction.timestamp,
    description: transaction.description,
    fingerprint: transaction.fingerprint,
    riskScore: transaction.riskScore,
    riskLevel: transaction.riskLevel satisfies RiskLevel,
  };
}

export function toRejectionRow(rejection: NewRejection): NewRejectionRecord {
  return {
    id: rejection.id,
    importId: rejection.importId,
    lineNumber: rejection.lineNumber,
    reason: rejection.reason,
    message: rejection.message,
    rawValue: rejection.rawValue,
  };
}
