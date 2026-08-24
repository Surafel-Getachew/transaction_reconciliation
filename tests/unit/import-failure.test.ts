import { describe, it, expect } from 'vitest';
import { classifyImportFailure } from '../../src/domain/errors/import-failure.js';

/** Verbatim messages captured from PostgreSQL 16 via node-postgres. */
const POSTGRES_ERRORS = [
  {
    code: '23505',
    message: 'duplicate key value violates unique constraint "acct_pkey"',
    leaks: 'acct_pkey',
  },
  {
    code: '23502',
    message:
      'null value in column "secret_col" of relation "acct" violates not-null constraint',
    leaks: 'secret_col',
  },
  {
    code: '42703',
    message: 'column "internal_pricing_key" does not exist',
    leaks: 'internal_pricing_key',
  },
  {
    code: '42601',
    message: 'syntax error at or near "FRM"',
    leaks: 'FRM',
  },
];

describe('classifyImportFailure', () => {
  it.each(POSTGRES_ERRORS)(
    'should not leak schema or SQL from a $code error',
    ({ code, message, leaks }) => {
      const failure = classifyImportFailure(
        Object.assign(new Error(message), { code, severity: 'ERROR' })
      );

      expect(failure.code).toBe('PERSISTENCE_FAILED');
      expect(failure.reason).not.toContain(leaks);
      expect(failure.reason).not.toContain(message);
    }
  );

  it('should classify filesystem errors as a storage read failure', () => {
    const failure = classifyImportFailure(
      Object.assign(new Error("ENOENT: no such file '/srv/app/uploads/x'"), {
        code: 'ENOENT',
      })
    );
    expect(failure.code).toBe('STORAGE_READ_FAILED');
    expect(failure.reason).not.toContain('/srv/app/uploads');
  });

  it('should classify an abort as cancellation', () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(classifyImportFailure(aborted).code).toBe('CANCELLED');
  });

  it('should fall back to a generic processing failure', () => {
    expect(classifyImportFailure(new Error('boom')).code).toBe(
      'PROCESSING_FAILED'
    );
    expect(classifyImportFailure(undefined).code).toBe('PROCESSING_FAILED');
  });

  it('should never return a reason derived from the original message', () => {
    const failure = classifyImportFailure(
      new Error('INSERT INTO transactions (provider_id) VALUES ($1)')
    );
    expect(failure.reason).not.toMatch(/INSERT|transactions|provider_id|\$1/);
  });
});
