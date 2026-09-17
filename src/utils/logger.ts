/**
 * Logger for MCP Server.
 * All diagnostic and debug logs are redirected to stderr to prevent
 * polluting stdout which is reserved exclusively for MCP JSON-RPC protocol messages.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

class Logger {
  private level: LogLevel = "info";

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(targetLevel: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };
    return levels[targetLevel] >= levels[this.level];
  }

  public debug(message: string, ...meta: unknown[]): void {
    if (this.shouldLog("debug")) {
      console.error(`[DEBUG] ${message}`, ...meta);
    }
  }

  public info(message: string, ...meta: unknown[]): void {
    if (this.shouldLog("info")) {
      console.error(`[INFO] ${message}`, ...meta);
    }
  }

  public warn(message: string, ...meta: unknown[]): void {
    if (this.shouldLog("warn")) {
      console.error(`[WARN] ${message}`, ...meta);
    }
  }

  public error(message: string, ...meta: unknown[]): void {
    if (this.shouldLog("error")) {
      console.error(`[ERROR] ${message}`, ...meta);
    }
  }
}

export const logger = new Logger();
