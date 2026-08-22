export interface RawTransactionInput {
  transactionId?: any;
  accountId?: any;
  merchantId?: any;
  amount?: any;
  currency?: any;
  timestamp?: any;
  description?: any;
}

export interface NormalizedTransaction {
  transactionId: string;
  accountId: string;
  merchantId: string;
  amount: number;
  currency: string;
  timestamp: string; // ISO 8601 string
  description: string | null;
}

export class TransactionNormalizer {
  public static normalize(input: RawTransactionInput): NormalizedTransaction {
    const transactionId = String(input.transactionId || '').trim();
    const accountId = String(input.accountId || '').trim();
    const merchantId = String(input.merchantId || '').trim();
    const amount = typeof input.amount === 'number' ? input.amount : parseFloat(String(input.amount || 0));
    const currency = String(input.currency || '').trim().toUpperCase();

    let timestampStr = String(input.timestamp || '').trim();
    const dateObj = new Date(timestampStr);
    const timestamp = !isNaN(dateObj.getTime()) ? dateObj.toISOString() : timestampStr;

    let description: string | null = null;
    if (input.description !== undefined && input.description !== null) {
      const trimmed = String(input.description).trim();
      description = trimmed.substring(0, 500);
    }

    return {
      transactionId,
      accountId,
      merchantId,
      amount,
      currency,
      timestamp,
      description,
    };
  }
}
