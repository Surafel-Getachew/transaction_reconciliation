import { describe, it, expect } from 'vitest';
import { RiskScorer } from '../../src/domain/services/risk-scorer.js';

describe('RiskScorer', () => {
  it('should return deterministic risk score and level within 0-100', () => {
    const input = {
      amount: 1500,
      descriptionLength: 120,
      transactionHour: 3,
      merchantId: 'merchant-99',
      fingerprint: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    };

    const res1 = RiskScorer.calculate(input);
    const res2 = RiskScorer.calculate(input);

    expect(res1.riskScore).toBe(res2.riskScore);
    expect(res1.riskLevel).toBe(res2.riskLevel);
    expect(res1.riskScore).toBeGreaterThanOrEqual(0);
    expect(res1.riskScore).toBeLessThanOrEqual(100);
    expect(['low', 'medium', 'high']).toContain(res1.riskLevel);
  });

  it('should allow the fingerprint to influence the score', () => {
    const scores = new Set<number>();

    for (let i = 0; i < 12; i++) {
      scores.add(
        RiskScorer.calculate({
          amount: 1500,
          descriptionLength: 120,
          transactionHour: 3,
          merchantId: 'merchant-99',
          fingerprint: i.toString(16).padStart(64, '0'),
        }).riskScore,
      );
    }

    expect(scores.size).toBeGreaterThan(1);
  });

  it('should make the full 0-100 score range reachable', () => {
    const baseInput = {
      amount: 10_000,
      descriptionLength: 450,
      transactionHour: 3,
      merchantId: 'merchant-0',
    };

    expect(
      RiskScorer.calculate({
        ...baseInput,
        fingerprint: '1'.padStart(64, '0'),
      }).riskScore,
    ).toBe(100);
  });
});
