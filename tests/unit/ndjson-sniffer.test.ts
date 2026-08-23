import { describe, it, expect } from 'vitest';
import { NdjsonSniffer } from '../../src/domain/services/ndjson-sniffer.js';

const record = (id: string) =>
  JSON.stringify({
    transactionId: id,
    accountId: 'acc-200',
    merchantId: 'merchant-300',
    amount: 150.75,
    currency: 'USD',
    timestamp: '2026-07-20T10:25:00.000Z',
  });

describe('NdjsonSniffer', () => {
  it('should accept NDJSON content', () => {
    expect(
      NdjsonSniffer.looksLikeNdjson(`${record('txn-1')}\n${record('txn-2')}\n`)
    ).toBe(true);
  });

  it('should accept a final line without a trailing newline', () => {
    expect(NdjsonSniffer.looksLikeNdjson(record('txn-1'))).toBe(true);
  });

  it('should skip leading blank lines and a byte order mark', () => {
    expect(NdjsonSniffer.looksLikeNdjson(`﻿\n  \n${record('txn-1')}\n`)).toBe(
      true
    );
  });

  it('should reject a JSON array file', () => {
    expect(NdjsonSniffer.looksLikeNdjson(`[${record('txn-1')}]`)).toBe(false);
  });

  it('should reject pretty-printed JSON', () => {
    expect(
      NdjsonSniffer.looksLikeNdjson('{\n  "transactionId": "txn-1"\n}\n')
    ).toBe(false);
  });

  it('should reject CSV content', () => {
    expect(
      NdjsonSniffer.looksLikeNdjson('transactionId,amount\ntxn-1,150.75\n')
    ).toBe(false);
  });

  it('should reject binary content containing null bytes', () => {
    expect(NdjsonSniffer.looksLikeNdjson('PK\0\0payload')).toBe(
      false
    );
  });

  it('should reject an empty file', () => {
    expect(NdjsonSniffer.looksLikeNdjson('')).toBe(false);
    expect(NdjsonSniffer.looksLikeNdjson('\n\n  \n')).toBe(false);
  });

  it('should reject an unterminated line that is not valid JSON', () => {
    expect(NdjsonSniffer.looksLikeNdjson('{"transactionId": "txn-1"')).toBe(
      false
    );
  });

  it('should accept a first record cut short by the sniff window', () => {
    expect(
      NdjsonSniffer.looksLikeNdjson('{"transactionId": "txn-1", "desc": "aaa', true)
    ).toBe(true);
  });

  it('should still parse earlier lines when the window is truncated', () => {
    expect(
      NdjsonSniffer.looksLikeNdjson(`${record('txn-1')}\n{"partial": "aa`, true)
    ).toBe(true);
    expect(NdjsonSniffer.looksLikeNdjson('nope,csv\n{"a":1', true)).toBe(false);
  });
});
