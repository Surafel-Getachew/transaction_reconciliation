import { describe, it, expect } from 'vitest';
import { TransactionNormalizer } from '../../src/domain/services/normalizer.js';

describe('TransactionNormalizer', () => {
  it('should trim string values and uppercase currency', () => {
    const raw = {
      transactionId: '  txn-999  ',
      accountId: ' acc-1 ',
      merchantId: ' merchant-2 ',
      amount: ' 299.99 ',
      currency: ' usd ',
      timestamp: '2026-07-20T10:25:00.000Z',
      description: '  Subscription payment  ',
    };

    const norm = TransactionNormalizer.normalize(raw);
    expect(norm.transactionId).toBe('txn-999');
    expect(norm.accountId).toBe('acc-1');
    expect(norm.merchantId).toBe('merchant-2');
    expect(norm.amount).toBe(299.99);
    expect(norm.currency).toBe('USD');
    expect(norm.description).toBe('Subscription payment');
  });

  it('should truncate descriptions longer than 500 characters', () => {
    const longDesc = 'a'.repeat(600);
    const raw = {
      transactionId: 'txn-1',
      accountId: 'acc-1',
      merchantId: 'mer-1',
      amount: 10,
      currency: 'USD',
      timestamp: '2026-07-20T10:25:00.000Z',
      description: longDesc,
    };

    const norm = TransactionNormalizer.normalize(raw);
    expect(norm.description?.length).toBe(500);
  });
});
