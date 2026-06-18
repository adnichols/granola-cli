import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRecoveryError, handleGlobalError } from '../../src/lib/errors.js';
import { ApiError } from '../../src/lib/http.js';

describe('handleGlobalError', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('AuthRecoveryError handling', () => {
    it('should return exit code 2 with refresh failure details', () => {
      const error = new AuthRecoveryError('Authentication required; token refresh failed.', [
        'The CLI attempted to refresh the stored access token before stopping.',
        'The imported desktop plaintext credentials may be stale.',
      ]);

      const exitCode = handleGlobalError(error);

      expect(exitCode).toBe(2);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        'Authentication required; token refresh failed.',
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'The imported desktop plaintext credentials may be stale.',
      );
    });
  });

  describe('ApiError handling', () => {
    it('should return exit code 2 for 401 errors', () => {
      const error = new ApiError('HTTP 401: Unauthorized', 401);

      const exitCode = handleGlobalError(error);

      expect(exitCode).toBe(2);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        'Authentication required.',
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('granola auth login'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('rerunning login may not fix'),
      );
    });

    it('should return exit code 1 for other API errors', () => {
      const error = new ApiError('HTTP 500: Internal Server Error', 500);

      const exitCode = handleGlobalError(error);

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        'HTTP 500: Internal Server Error',
      );
    });

    it('should return exit code 1 for 403 errors', () => {
      const error = new ApiError('HTTP 403: Forbidden', 403);

      const exitCode = handleGlobalError(error);

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        'HTTP 403: Forbidden',
      );
    });

    it('should return exit code 1 for 404 errors', () => {
      const error = new ApiError('HTTP 404: Not Found', 404);

      const exitCode = handleGlobalError(error);

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        'HTTP 404: Not Found',
      );
    });
  });

  describe('network error handling', () => {
    it('should return exit code 1 for fetch failed errors', () => {
      const error = new Error('fetch failed: ECONNREFUSED');

      const exitCode = handleGlobalError(error);

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        'Network error. Check your connection.',
      );
    });

    it('should return exit code 1 for network timeout errors', () => {
      const error = new Error('fetch failed: ETIMEDOUT');

      const exitCode = handleGlobalError(error);

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        'Network error. Check your connection.',
      );
    });
  });

  describe('generic error handling', () => {
    it('should return exit code 1 for generic errors', () => {
      const error = new Error('Something went wrong');

      const exitCode = handleGlobalError(error);

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        'Something went wrong',
      );
    });

    it('should handle errors with empty message', () => {
      const error = new Error('');

      const exitCode = handleGlobalError(error);

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        'An unexpected error occurred.',
      );
    });

    it('should return exit code 1 for non-Error objects', () => {
      const exitCode = handleGlobalError('string error');

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        'An unexpected error occurred.',
      );
    });

    it('should return exit code 1 for null', () => {
      const exitCode = handleGlobalError(null);

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        'An unexpected error occurred.',
      );
    });

    it('should return exit code 1 for undefined', () => {
      const exitCode = handleGlobalError(undefined);

      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        'An unexpected error occurred.',
      );
    });
  });
});
