import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock auth module
vi.mock('../../src/lib/auth.js', () => ({
  getCredentials: vi.fn(),
  saveCredentials: vi.fn(),
  refreshAccessTokenWithResult: vi.fn(),
}));

// Mock http client
vi.mock('../../src/lib/http.js', () => ({
  createHttpClient: vi.fn(),
}));

// Mock api client
vi.mock('../../src/lib/api.js', () => ({
  createApiClient: vi.fn(),
}));

import { createApiClient } from '../../src/lib/api.js';
import * as auth from '../../src/lib/auth.js';
import { createHttpClient } from '../../src/lib/http.js';
import { getClient, resetClient, withTokenRefresh } from '../../src/services/client.js';

describe('client service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClient();
  });

  describe('getClient', () => {
    it('should create client when credentials exist', async () => {
      const mockCreds = {
        refreshToken: 'test-refresh-token',
        accessToken: 'test-access-token',
        clientId: 'test-client-id',
      };

      vi.mocked(auth.getCredentials).mockResolvedValue(mockCreds);

      const mockHttpClient = { post: vi.fn(), setToken: vi.fn() };
      vi.mocked(createHttpClient).mockReturnValue(mockHttpClient);

      const mockApiClient = { getDocuments: vi.fn() };
      vi.mocked(createApiClient).mockReturnValue(mockApiClient as never);

      const client = await getClient();

      expect(auth.getCredentials).toHaveBeenCalled();
      expect(createHttpClient).toHaveBeenCalledWith('test-access-token');
      expect(createApiClient).toHaveBeenCalledWith(mockHttpClient);
      expect(client).toBe(mockApiClient);
    });

    it('should return cached client on subsequent calls', async () => {
      const mockCreds = {
        refreshToken: 'test-refresh-token',
        accessToken: 'test-access-token',
        clientId: 'test-client-id',
      };

      vi.mocked(auth.getCredentials).mockResolvedValue(mockCreds);

      const mockHttpClient = { post: vi.fn(), setToken: vi.fn() };
      vi.mocked(createHttpClient).mockReturnValue(mockHttpClient);

      const mockApiClient = { getDocuments: vi.fn() };
      vi.mocked(createApiClient).mockReturnValue(mockApiClient as never);

      const client1 = await getClient();
      const client2 = await getClient();

      expect(auth.getCredentials).toHaveBeenCalledTimes(1);
      expect(createHttpClient).toHaveBeenCalledTimes(1);
      expect(createApiClient).toHaveBeenCalledTimes(1);
      expect(client1).toBe(client2);
    });

    it('should exit with code 2 when not authenticated', async () => {
      vi.mocked(auth.getCredentials).mockResolvedValue(null);

      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(getClient()).rejects.toThrow('process.exit called');

      // First call shows "Error: Not authenticated."
      expect(mockError).toHaveBeenCalledWith(
        expect.anything(), // chalk.red('Error:')
        'Not authenticated.',
      );
      expect(mockExit).toHaveBeenCalledWith(2);

      mockExit.mockRestore();
      mockError.mockRestore();
    });
  });

  describe('withTokenRefresh', () => {
    it('should return result when operation succeeds', async () => {
      const mockOperation = vi.fn().mockResolvedValue('success');

      const result = await withTokenRefresh(mockOperation);

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
      expect(auth.refreshAccessTokenWithResult).not.toHaveBeenCalled();
    });

    it('should retry operation after 401 and successful refresh', async () => {
      const mockCreds = {
        refreshToken: 'new-refresh-token',
        accessToken: 'new-access-token',
        clientId: 'test-client-id',
      };

      const error401 = { status: 401, message: 'Unauthorized' };
      const mockOperation = vi
        .fn()
        .mockRejectedValueOnce(error401)
        .mockResolvedValueOnce('success after refresh');

      vi.mocked(auth.refreshAccessTokenWithResult).mockResolvedValue({
        ok: true,
        credentials: mockCreds,
      });
      vi.mocked(auth.getCredentials).mockResolvedValue(mockCreds);

      const mockHttpClient = { post: vi.fn(), setToken: vi.fn() };
      vi.mocked(createHttpClient).mockReturnValue(mockHttpClient);

      const mockApiClient = { getDocuments: vi.fn() };
      vi.mocked(createApiClient).mockReturnValue(mockApiClient as never);

      const result = await withTokenRefresh(mockOperation);

      expect(result).toBe('success after refresh');
      expect(mockOperation).toHaveBeenCalledTimes(2);
      expect(auth.refreshAccessTokenWithResult).toHaveBeenCalledTimes(1);
    });

    it('should throw auth recovery error when refresh fails after 401', async () => {
      const error401 = { status: 401, message: 'Unauthorized' };
      const mockOperation = vi.fn().mockRejectedValue(error401);

      vi.mocked(auth.refreshAccessTokenWithResult).mockResolvedValue({
        ok: false,
        reason: 'server_rejected',
        status: 400,
        statusText: 'Bad Request',
      });

      await expect(withTokenRefresh(mockOperation)).rejects.toThrow(
        'Authentication required; token refresh failed.',
      );
      expect(mockOperation).toHaveBeenCalledTimes(1);
      expect(auth.refreshAccessTokenWithResult).toHaveBeenCalledTimes(1);
    });

    it('should not retry on non-401 errors', async () => {
      const error500 = { status: 500, message: 'Internal Server Error' };
      const mockOperation = vi.fn().mockRejectedValue(error500);

      await expect(withTokenRefresh(mockOperation)).rejects.toEqual(error500);
      expect(mockOperation).toHaveBeenCalledTimes(1);
      expect(auth.refreshAccessTokenWithResult).not.toHaveBeenCalled();
    });

    it('should handle errors without status property', async () => {
      const genericError = new Error('Network error');
      const mockOperation = vi.fn().mockRejectedValue(genericError);

      await expect(withTokenRefresh(mockOperation)).rejects.toEqual(genericError);
      expect(mockOperation).toHaveBeenCalledTimes(1);
      expect(auth.refreshAccessTokenWithResult).not.toHaveBeenCalled();
    });
  });
});
