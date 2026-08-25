/**
 * 极简日志器（替代 Nest Logger，供 agent-core 纯 TS 使用）。
 * 输出到 stdout/stderr，带时间戳、级别、可选 context 前缀。
 */

export type LogLevel = 'debug' | 'log' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  log: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  private readonly context: string;
  private readonly minLevel: LogLevel;

  constructor(context: string, minLevel: LogLevel = 'log') {
    this.context = context;
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }

  private format(level: LogLevel, message: string): string {
    const ts = new Date().toISOString();
    return `[${ts}] [${level.toUpperCase()}] ${this.context} ${message}`;
  }

  debug(message: string): void {
    if (this.shouldLog('debug')) process.stdout.write(this.format('debug', message) + '\n');
  }

  log(message: string): void {
    if (this.shouldLog('log')) process.stdout.write(this.format('log', message) + '\n');
  }

  warn(message: string): void {
    if (this.shouldLog('warn')) process.stderr.write(this.format('warn', message) + '\n');
  }

  error(message: string, stack?: string): void {
    if (this.shouldLog('error')) {
      process.stderr.write(this.format('error', message) + '\n');
      if (stack) process.stderr.write(stack + '\n');
    }
  }
}
