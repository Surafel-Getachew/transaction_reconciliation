import { pino, Logger } from "pino";
import { ILogger, LogFields } from "../../domain/logging/logger.interface.js";

class PinoLogger implements ILogger {
  constructor(private readonly logger: Logger) {}

  debug(fields: LogFields, message: string): void {
    this.logger.debug(fields, message);
  }

  info(fields: LogFields, message: string): void {
    this.logger.info(fields, message);
  }

  warn(fields: LogFields, message: string): void {
    this.logger.warn(fields, message);
  }

  error(fields: LogFields, message: string): void {
    this.logger.error(fields, message);
  }

  child(fields: LogFields): ILogger {
    return new PinoLogger(this.logger.child(fields));
  }
}

export function createLogger(): ILogger {
  return new PinoLogger(
    pino({
      level: process.env.LOG_LEVEL || "info",
      base: { service: "transaction-import" },
      redact: {
        paths: ["description", "*.description", "*.rawValue"],
        censor: "[redacted]",
      },
    }),
  );
}
