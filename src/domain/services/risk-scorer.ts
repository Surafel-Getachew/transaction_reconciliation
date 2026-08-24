import crypto from 'node:crypto';

export interface RiskInput {
  amount: number;
  descriptionLength: number;
  transactionHour: number;
  merchantId: string;
  fingerprint: string;
}

export interface RiskResult {
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export class RiskScorer {
  public static calculate(input: RiskInput): RiskResult {
    // 1. Amount factor (0 - 35 points), scaled logarithmically so that
    // ordinary transaction amounts still contribute meaningfully without
    // letting large amounts dominate the entire score.
    const safeAmount = Math.max(0, input.amount);
    const amountScore = Math.min(
      35,
      Math.floor((Math.log1p(safeAmount) / Math.log1p(10_000)) * 35),
    );

    // 2. Description length factor (0 - 15 points)
    const descScore = Math.min(15, Math.floor(input.descriptionLength / 30));

    // 3. Hour of transaction factor (0 - 25 points)
    const hourScore = input.transactionHour >= 0 && input.transactionHour <= 5 ? 25 : 5;

    // 4. Merchant hash factor (0 - 15 points)
    let merchantHash = 0;
    for (let i = 0; i < input.merchantId.length; i++) {
      merchantHash = (merchantHash + input.merchantId.charCodeAt(i)) % 16;
    }

    // 5. CPU-intensive simulation (crypto hashing loop)
    let hash = input.fingerprint;
    for (let i = 0; i < 500; i++) {
      hash = crypto.createHash('sha256').update(hash).digest('hex');
    }

    // Use the final digest as a deterministic 0-10 point signal. The hashing
    // work remains CPU-bound, but its result contributes to risk scoring.
    const fingerprintScore = parseInt(hash.slice(0, 2), 16) % 11;

    const totalScore = Math.min(
      100,
      Math.max(
        0,
        amountScore +
          descScore +
          hourScore +
          merchantHash +
          fingerprintScore,
      ),
    );

    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (totalScore >= 70) {
      riskLevel = 'high';
    } else if (totalScore >= 40) {
      riskLevel = 'medium';
    }

    return {
      riskScore: totalScore,
      riskLevel,
    };
  }
}
