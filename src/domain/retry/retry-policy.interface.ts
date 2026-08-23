export interface RetryContext {
  operationName: string;
}

export interface IRetryPolicy {
  execute<T>(fn: () => Promise<T>, context: RetryContext): Promise<T>;
}

export const noRetryPolicy: IRetryPolicy = {
  execute: (fn) => fn(),
};
