import { describe, it, expect } from 'vitest';
import { TransactionValidator } from '../../src/domain/services/validator.js';

describe('TransactionValidator', () => {
  it('should pass valid transaction record', () => {
    const valid = {
      transactionId: 'txn-100',
      accountId: 'acc-200',
      merchantId: 'merchant-300',
      amount: 150.75,
      currency: 'USD',
      timestamp: '2026-07-20T10:25:00.000Z',
      description: 'Test payment',
    };

    const res = TransactionValidator.validate(valid);
    expect(res.success).toBe(true);
    expect(res.data?.currency).toBe('USD');
  });

  it('should reject missing transactionId', () => {
    const invalid = {
      accountId: 'acc-200',
      merchantId: 'merchant-300',
      amount: 150.75,
      currency: 'USD',
      timestamp: '2026-07-20T10:25:00.000Z',
    };

    const res = TransactionValidator.validate(invalid);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('MISSING_TRANSACTION_ID');
  });

  it('should reject non-positive amount', () => {
    const invalid = {
      transactionId: 'txn-100',
      accountId: 'acc-200',
      merchantId: 'merchant-300',
      amount: -5.0,
      currency: 'USD',
      timestamp: '2026-07-20T10:25:00.000Z',
    };

    const res = TransactionValidator.validate(invalid);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('INVALID_AMOUNT');
  });

  it('should reject unsupported currency code', () => {
    const invalid = {
      transactionId: 'txn-100',
      accountId: 'acc-200',
      merchantId: 'merchant-300',
      amount: 50.0,
      currency: 'INVALID_CURRENCY',
      timestamp: '2026-07-20T10:25:00.000Z',
    };

    const res = TransactionValidator.validate(invalid);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('INVALID_CURRENCY');
  });

  it('should reject invalid timestamp format', () => {
    const invalid = {
      transactionId: 'txn-100',
      accountId: 'acc-200',
      merchantId: 'merchant-300',
      amount: 50.0,
      currency: 'USD',
      timestamp: 'not-a-date',
    };

    const res = TransactionValidator.validate(invalid);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('INVALID_TIMESTAMP');
  });
});
