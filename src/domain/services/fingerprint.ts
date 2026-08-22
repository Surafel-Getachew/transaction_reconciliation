import crypto from 'node:crypto';
import { NormalizedTransaction } from './normalizer.js';

/**
 * Calculates a deterministic SHA-256 fingerprint from normalized transaction fields.
 * Included fields in deterministic order: transactionId, accountId, merchantId, amount, currency, timestamp.
 */
export class FingerprintCalculator {
  public static calculate(tx: NormalizedTransaction): string {
    const payload = [
      tx.transactionId,
      tx.accountId,
      tx.merchantId,
      tx.amount.toFixed(2),
      tx.currency,
      tx.timestamp,
    ].join('|');

    return crypto.createHash('sha256').update(payload).digest('hex');
  }
}
