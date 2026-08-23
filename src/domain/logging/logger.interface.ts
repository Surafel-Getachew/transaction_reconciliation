export type LogFields = Record<string, unknown>;

export interface ILogger {
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
  child(fields: LogFields): ILogger;
}

export const silentLogger: ILogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => silentLogger,
};
