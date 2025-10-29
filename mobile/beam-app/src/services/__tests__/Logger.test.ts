/**
 * Logger Service Unit Tests
 *
 * Tests:
 * - Log level filtering
 * - Sensitive data redaction
 * - Performance tracking
 * - Context sanitization
 */

import { logger, LogLevel, createModuleLogger } from '../Logger';

describe('Logger', () => {
  beforeEach(() => {
    logger.clear();
    logger.setMinLevel(LogLevel.DEBUG);
  });

  describe('Log levels', () => {
    it('should log messages at or above min level', () => {
      logger.setMinLevel(LogLevel.WARN);

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      const logs = logger.getRecentLogs();
      expect(logs.length).toBe(2); // Only WARN and ERROR
      expect(logs[0].level).toBe(LogLevel.WARN);
      expect(logs[1].level).toBe(LogLevel.ERROR);
    });

    it('should respect DEBUG level in development', () => {
      logger.setMinLevel(LogLevel.DEBUG);

      logger.debug('Debug message');
      const logs = logger.getRecentLogs();

      expect(logs.length).toBe(1);
      expect(logs[0].message).toBe('Debug message');
    });
  });

  describe('Sensitive data redaction', () => {
    it('should redact private keys (hex format)', () => {
      const privateKeyHex = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      logger.info(`Private key: ${privateKeyHex}`);

      const logs = logger.getRecentLogs();
      expect(logs[0].message).toContain('[REDACTED]');
      expect(logs[0].message).not.toContain(privateKeyHex);
    });

    it('should redact signatures in JSON', () => {
      const jsonWithSignature = JSON.stringify({
        tx_id: '123',
        signature: 'sensitive_signature_data_12345',
      });

      logger.info(`Transaction: ${jsonWithSignature}`);
      const logs = logger.getRecentLogs();

      expect(logs[0].message).toContain('[REDACTED]');
      expect(logs[0].message).not.toContain('sensitive_signature_data_12345');
    });

    it('should redact secrets in context', () => {
      logger.info('Operation completed', {
        module: 'wallet',
        secret: 'my_secret_value',
        privateKey: 'private_key_data',
      });

      const logs = logger.getRecentLogs();
      expect(logs[0].context?.secret).toBe('[REDACTED]');
      expect(logs[0].context?.privateKey).toBe('[REDACTED]');
    });

    it('should redact PII (email addresses)', () => {
      logger.info('User registered: test@example.com');
      const logs = logger.getRecentLogs();

      expect(logs[0].message).toContain('[PII_REDACTED]');
      expect(logs[0].message).not.toContain('test@example.com');
    });

    it('should preserve safe data', () => {
      logger.info('Transaction successful', {
        module: 'settlement',
        amount: 100,
        bundleId: 'tx_123',
      });

      const logs = logger.getRecentLogs();
      expect(logs[0].context?.module).toBe('settlement');
      expect(logs[0].context?.amount).toBe(100);
      expect(logs[0].context?.bundleId).toBe('tx_123');
    });
  });

  describe('Error logging', () => {
    it('should capture error details', () => {
      const error = new Error('Test error');
      logger.error('Operation failed', { operation: 'test' }, error);

      const logs = logger.getRecentLogs();
      expect(logs[0].error).toBeDefined();
      expect(logs[0].error?.name).toBe('Error');
      expect(logs[0].error?.message).toBe('Test error');
    });

    it('should redact sensitive data in error messages', () => {
      const error = new Error('Failed with key: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
      logger.error('Crypto operation failed', {}, error);

      const logs = logger.getRecentLogs();
      expect(logs[0].error?.message).toContain('[REDACTED]');
    });
  });

  describe('Performance tracking', () => {
    it('should track performance metrics', () => {
      logger.trackPerformance({
        operation: 'wallet.sign',
        durationMs: 150,
        timestamp: Date.now(),
        success: true,
      });

      const metrics = logger.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].operation).toBe('wallet.sign');
      expect(metrics[0].durationMs).toBe(150);
      expect(metrics[0].success).toBe(true);
    });

    it('should measure async operations', async () => {
      const testOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'result';
      };

      const result = await logger.measureAsync('test.operation', testOperation);

      expect(result).toBe('result');
      const metrics = logger.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].operation).toBe('test.operation');
      expect(metrics[0].durationMs).toBeGreaterThanOrEqual(100);
      expect(metrics[0].success).toBe(true);
    });

    it('should track failed operations', async () => {
      const failingOperation = async () => {
        throw new Error('Operation failed');
      };

      await expect(logger.measureAsync('test.failing', failingOperation)).rejects.toThrow('Operation failed');

      const metrics = logger.getMetrics();
      expect(metrics[0].success).toBe(false);
    });

    it('should calculate metrics summary', () => {
      logger.trackPerformance({
        operation: 'op1',
        durationMs: 100,
        timestamp: Date.now(),
        success: true,
      });
      logger.trackPerformance({
        operation: 'op2',
        durationMs: 200,
        timestamp: Date.now(),
        success: true,
      });
      logger.trackPerformance({
        operation: 'op3',
        durationMs: 150,
        timestamp: Date.now(),
        success: false,
      });

      const summary = logger.getMetricsSummary();
      expect(summary.averageDuration).toBe(150);
      expect(summary.successRate).toBeCloseTo(0.666, 2);
      expect(summary.totalOperations).toBe(3);
      expect(summary.slowestOperations.length).toBeGreaterThan(0);
      expect(summary.slowestOperations[0].durationMs).toBe(200);
    });
  });

  describe('Module logger', () => {
    it('should create module-scoped logger', () => {
      const walletLogger = createModuleLogger('WalletManager');

      walletLogger.info('Wallet operation', { operation: 'sign' });

      const logs = logger.getRecentLogs();
      expect(logs[0].context?.module).toBe('WalletManager');
      expect(logs[0].context?.operation).toBe('sign');
    });

    it('should include module in performance metrics', async () => {
      const walletLogger = createModuleLogger('WalletManager');

      await walletLogger.measureAsync('signTransaction', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      const metrics = logger.getMetrics();
      expect(metrics[0].operation).toBe('WalletManager.signTransaction');
    });
  });

  describe('Log retention', () => {
    it('should limit log buffer size', () => {
      // Generate more logs than max size (1000)
      for (let i = 0; i < 1500; i++) {
        logger.debug(`Log ${i}`);
      }

      const logs = logger.getRecentLogs(2000);
      expect(logs.length).toBeLessThanOrEqual(1000);
    });

    it('should limit metrics buffer size', () => {
      // Generate more metrics than max size (500)
      for (let i = 0; i < 700; i++) {
        logger.trackPerformance({
          operation: `op${i}`,
          durationMs: i,
          timestamp: Date.now(),
          success: true,
        });
      }

      const metrics = logger.getMetrics();
      expect(metrics.length).toBeLessThanOrEqual(500);
    });
  });

  describe('Clear functionality', () => {
    it('should clear all logs and metrics', () => {
      logger.info('Test log');
      logger.trackPerformance({
        operation: 'test',
        durationMs: 100,
        timestamp: Date.now(),
        success: true,
      });

      logger.clear();

      expect(logger.getRecentLogs().length).toBe(0);
      expect(logger.getMetrics().length).toBe(0);
    });
  });
});
