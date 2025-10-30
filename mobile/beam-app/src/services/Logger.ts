/**
 * Production Logger Service
 *
 * Structured logging with:
 * - Log levels (ERROR, WARN, INFO, DEBUG)
 * - Sensitive data redaction
 * - Performance metrics collection
 * - Error tracking integration ready
 *
 * @security Critical: Never log private keys, signatures, or PII
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  CRITICAL = 4,
}

export interface LogContext {
  module?: string;
  operation?: string;
  userId?: string;
  sessionId?: string;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: Error;
  metadata?: Record<string, any>;
}

export interface PerformanceMetric {
  operation: string;
  durationMs: number;
  timestamp: number;
  success: boolean;
  metadata?: Record<string, any>;
}

/**
 * Sensitive data patterns to redact from logs
 * SECURITY: Add any patterns that might contain sensitive data
 */
const SENSITIVE_PATTERNS = [
  /\b[0-9a-fA-F]{64}\b/g, // Private keys (hex)
  /\b[1-9A-HJ-NP-Za-km-z]{87,88}\b/g, // Base58 private keys
  /\b[A-Za-z0-9+/]{86,88}={0,2}\b/g, // Base64 secrets (long)
  /"signature":\s*"[^"]+"/g, // Signature fields in JSON
  /"secret":\s*"[^"]+"/g, // Secret fields
  /"privateKey":\s*"[^"]+"/g, // Private key fields
  /"password":\s*"[^"]+"/g, // Password fields
];

/**
 * PII patterns to redact
 */
const PII_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
  /\b\d{16}\b/g, // Credit card numbers
];

class Logger {
  private minLevel: LogLevel = __DEV__ ? LogLevel.DEBUG : LogLevel.INFO;
  private logs: LogEntry[] = [];
  private metrics: PerformanceMetric[] = [];
  private readonly maxLogSize = 1000; // Keep last 1000 logs in memory
  private readonly maxMetricsSize = 500; // Keep last 500 metrics

  /**
   * Set minimum log level
   */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Redact sensitive data from log messages
   * @security Critical function - must redact all sensitive patterns
   */
  private redact(message: string): string {
    let redacted = message;

    // Redact sensitive data
    for (const pattern of SENSITIVE_PATTERNS) {
      redacted = redacted.replace(pattern, '[REDACTED]');
    }

    // Redact PII
    for (const pattern of PII_PATTERNS) {
      redacted = redacted.replace(pattern, '[PII_REDACTED]');
    }

    return redacted;
  }

  /**
   * Sanitize context object by redacting sensitive fields
   */
  private sanitizeContext(context?: LogContext): LogContext | undefined {
    if (!context) return undefined;

    const sanitized: LogContext = {};
    for (const [key, value] of Object.entries(context)) {
      const lowerKey = key.toLowerCase();

      // Redact known sensitive fields
      if (
        lowerKey.includes('secret') ||
        lowerKey.includes('private') ||
        lowerKey.includes('password') ||
        lowerKey.includes('signature') ||
        lowerKey === 'keypair'
      ) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        sanitized[key] = this.redact(value);
      } else if (typeof value === 'object' && value !== null) {
        // Recursively sanitize nested objects
        sanitized[key] = JSON.parse(this.redact(JSON.stringify(value)));
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Core logging function
   */
  private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    if (level < this.minLevel) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message: this.redact(message),
      context: this.sanitizeContext(context),
      error: error ? {
        name: error.name,
        message: this.redact(error.message),
        stack: __DEV__ ? this.redact(error.stack || '') : undefined,
      } as any : undefined,
    };

    // Store in memory (circular buffer)
    this.logs.push(entry);
    if (this.logs.length > this.maxLogSize) {
      this.logs.shift();
    }

    // Console output in development
    if (__DEV__) {
      const levelName = LogLevel[level];
      const contextStr = context ? ` ${JSON.stringify(entry.context)}` : '';
      const errorStr = error ? `\n${error.stack}` : '';
      console.log(`[${levelName}] ${entry.message}${contextStr}${errorStr}`);
    }

    // TODO: Send to error tracking service (Sentry, Bugsnag, etc.) for ERROR and CRITICAL
    if (level >= LogLevel.ERROR) {
      this.sendToErrorTracking(entry);
    }
  }

  /**
   * Debug level logging (verbose, development only)
   */
  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Info level logging (general information)
   */
  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Warning level logging (potential issues)
   */
  warn(message: string, context?: LogContext, error?: Error): void {
    this.log(LogLevel.WARN, message, context, error);
  }

  /**
   * Error level logging (errors that should be investigated)
   */
  error(message: string, context?: LogContext, error?: Error): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  /**
   * Critical level logging (severe errors requiring immediate attention)
   */
  critical(message: string, context?: LogContext, error?: Error): void {
    this.log(LogLevel.CRITICAL, message, context, error);
  }

  /**
   * Track performance metrics
   */
  trackPerformance(metric: PerformanceMetric): void {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxMetricsSize) {
      this.metrics.shift();
    }

    if (__DEV__) {
      console.log(
        `[PERF] ${metric.operation}: ${metric.durationMs}ms (${metric.success ? 'success' : 'failed'})`
      );
    }

    // TODO: Send to analytics service
  }

  /**
   * Measure operation performance
   */
  async measureAsync<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const startTime = Date.now();
    let success = false;

    try {
      const result = await fn();
      success = true;
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const durationMs = Date.now() - startTime;
      this.trackPerformance({
        operation,
        durationMs,
        timestamp: startTime,
        success,
        metadata,
      });
    }
  }

  /**
   * Get recent logs (for debugging)
   */
  getRecentLogs(count: number = 50): LogEntry[] {
    return this.logs.slice(-count);
  }

  /**
   * Get performance metrics
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * Get metrics summary
   */
  getMetricsSummary(): {
    averageDuration: number;
    successRate: number;
    totalOperations: number;
    slowestOperations: Array<{ operation: string; durationMs: number }>;
  } {
    if (this.metrics.length === 0) {
      return {
        averageDuration: 0,
        successRate: 0,
        totalOperations: 0,
        slowestOperations: [],
      };
    }

    const totalDuration = this.metrics.reduce((sum, m) => sum + m.durationMs, 0);
    const successCount = this.metrics.filter(m => m.success).length;
    const slowest = [...this.metrics]
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 10)
      .map(m => ({ operation: m.operation, durationMs: m.durationMs }));

    return {
      averageDuration: totalDuration / this.metrics.length,
      successRate: successCount / this.metrics.length,
      totalOperations: this.metrics.length,
      slowestOperations: slowest,
    };
  }

  /**
   * Clear all logs and metrics (for testing)
   */
  clear(): void {
    this.logs = [];
    this.metrics = [];
  }

  /**
   * Send to error tracking service
   * TODO: Implement integration with Sentry, Bugsnag, or similar
   */
  private sendToErrorTracking(_entry: LogEntry): void {
    // Placeholder for error tracking integration
    // In production, this would send to Sentry, Bugsnag, etc.

    // Example Sentry integration (commented out):
    // import * as Sentry from '@sentry/react-native';
    // if (entry.error) {
    //   Sentry.captureException(entry.error, {
    //     level: entry.level >= LogLevel.CRITICAL ? 'fatal' : 'error',
    //     contexts: {
    //       custom: entry.context,
    //     },
    //   });
    // } else {
    //   Sentry.captureMessage(entry.message, {
    //     level: entry.level >= LogLevel.CRITICAL ? 'fatal' : 'error',
    //     contexts: {
    //       custom: entry.context,
    //     },
    //   });
    // }
  }
}

// Singleton instance
export const logger = new Logger();

/**
 * Helper function to create a module-scoped logger
 */
export function createModuleLogger(moduleName: string) {
  return {
    debug: (message: string, context?: Omit<LogContext, 'module'>) =>
      logger.debug(message, { ...context, module: moduleName }),
    info: (message: string, context?: Omit<LogContext, 'module'>) =>
      logger.info(message, { ...context, module: moduleName }),
    warn: (message: string, context?: Omit<LogContext, 'module'>, error?: Error) =>
      logger.warn(message, { ...context, module: moduleName }, error),
    error: (message: string, context?: Omit<LogContext, 'module'>, error?: Error) =>
      logger.error(message, { ...context, module: moduleName }, error),
    critical: (message: string, context?: Omit<LogContext, 'module'>, error?: Error) =>
      logger.critical(message, { ...context, module: moduleName }, error),
    measureAsync: <T>(operation: string, fn: () => Promise<T>, metadata?: Record<string, any>) =>
      logger.measureAsync(`${moduleName}.${operation}`, fn, metadata),
  };
}
