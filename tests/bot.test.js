import { jest } from '@jest/globals';
import { debug } from '../bot.js';

describe('Bot Utilities', () => {
  let consoleLogSpy;
  let consoleErrorSpy;
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv }; // Clone the environment
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv; // Restore original environment
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.resetModules();
  });

  describe('debug', () => {
    test('should log message with verbose level when debug mode is enabled', () => {
      process.env.DEBUG_MODE = 'true';
      debug('test message', 'verbose');
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[VERBOSE\] test message/);
    });

    test('should not log verbose message when debug mode is disabled', () => {
      process.env.DEBUG_MODE = 'false';
      debug('test message', 'verbose');
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    test('should log info message regardless of debug mode', () => {
      process.env.DEBUG_MODE = 'false';
      debug('info message', 'info');
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]  info message/);
    });

    test('should log error message with ERROR prefix', () => {
      debug('error message', 'error');
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[ERROR\] error message/);
    });

    test('should log additional data when provided', () => {
      const data = { key: 'value' };
      debug('message with data', 'info', data);
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      expect(consoleLogSpy.mock.calls[1][0]).toBe(data);
    });
  });
});
