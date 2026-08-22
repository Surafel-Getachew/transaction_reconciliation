import { z } from 'zod';

export const ISO_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'HKD', 'NZD',
  'SEK', 'NOK', 'SGD', 'MXN', 'INR', 'BRL', 'ZAR', 'RUB', 'KRW', 'TRY',
  'AED', 'SAR', 'EGP', 'PLN', 'THB', 'IDR', 'MYR', 'PHP', 'DKK', 'ILS',
]);

const requiredIdentifier = (field: string) =>
  z.string({ required_error: `${field} is required` })
    .trim()
    .min(1, `${field} cannot be empty`)
    .max(255, `${field} must not exceed 255 characters`);

export const TransactionSchema = z.object({
  transactionId: requiredIdentifier('transactionId'),
  accountId: requiredIdentifier('accountId'),
  merchantId: requiredIdentifier('merchantId'),
  amount: z
    .number({ invalid_type_error: 'amount must be a number' })
    .gt(0, 'amount must be greater than zero'),
  currency: z
    .string({ required_error: 'currency is required' })
    .transform((c) => c.trim().toUpperCase())
    .refine((c) => /^[A-Z]{3}$/.test(c) && ISO_CURRENCIES.has(c), {
      message: 'Currency must be a supported three-letter code',
    }),
  timestamp: z.string({ required_error: 'timestamp is required' }).trim().refine(
    (t) => {
      const d = Date.parse(t);
      return !isNaN(d);
    },
    { message: 'timestamp must be a valid ISO-8601 date' }
  ),
  description: z
    .string()
    .max(500, 'description must not exceed 500 characters')
    .optional()
    .nullable(),
}).strict();

export type ValidatedTransactionInput = z.infer<typeof TransactionSchema>;

export interface ValidationResult {
  success: boolean;
  data?: ValidatedTransactionInput;
  errorCode?: string;
  errorMessage?: string;
}

export class TransactionValidator {
  public static validate(raw: any): ValidationResult {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        success: false,
        errorCode: 'INVALID_JSON_OBJECT',
        errorMessage: 'Record must be a valid JSON object',
      };
    }

    const result = TransactionSchema.safeParse(raw);
    if (!result.success) {
      const issue = result.error.issues[0];
      let errorCode = 'VALIDATION_ERROR';
      if (issue.path.includes('currency')) {
        errorCode = 'INVALID_CURRENCY';
      } else if (issue.path.includes('amount')) {
        errorCode = 'INVALID_AMOUNT';
      } else if (issue.path.includes('timestamp')) {
        errorCode = 'INVALID_TIMESTAMP';
      } else if (issue.path.includes('transactionId')) {
        errorCode = 'MISSING_TRANSACTION_ID';
      } else if (issue.path.includes('accountId')) {
        errorCode = 'MISSING_ACCOUNT_ID';
      } else if (issue.path.includes('merchantId')) {
        errorCode = 'MISSING_MERCHANT_ID';
      }

      return {
        success: false,
        errorCode,
        errorMessage: issue.message,
      };
    }

    return {
      success: true,
      data: result.data,
    };
  }
}
