import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Credentials } from '../../src/types.js';

// Mock cross-keychain at the top level using hoisted mock
vi.mock('cross-keychain', () => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
}));

// Mock node:os for platform-specific path tests
vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
  platform: vi.fn(() => 'linux'),
}));

// Mock node:fs/promises for file-based credential tests
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

// Mock lock module to avoid file system operations in tests
vi.mock('../../src/lib/lock.js', () => ({
  withLock: vi.fn((operation: () => Promise<unknown>) => operation()),
}));

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
// Import the mocked module to access mock functions
import * as crossKeychain from 'cross-keychain';
// Import auth module after mocking
import {
  deleteCredentials,
  getAuthImportFailureMessage,
  getCredentials,
  getDefaultStoredAccountsPath,
  getDefaultSupabasePath,
  loadCredentialsFromFile,
  parseStoredAccountsJson,
  parseSupabaseJson,
  refreshAccessToken,
  refreshAccessTokenWithResult,
  saveCredentials,
} from '../../src/lib/auth.js';
import { withLock } from '../../src/lib/lock.js';

function missingFileError(): NodeJS.ErrnoException {
  return Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
}

describe('auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.stat).mockRejectedValue(missingFileError());
  });

  describe('getCredentials', () => {
    it('should return credentials when stored', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'test-refresh-token',
        accessToken: 'test-access-token',
        clientId: 'test-client-id',
      });

      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      const result = await getCredentials();

      expect(crossKeychain.getPassword).toHaveBeenCalledWith('com.granola.cli', 'credentials');
      expect(result).toEqual({
        refreshToken: 'test-refresh-token',
        accessToken: 'test-access-token',
        clientId: 'test-client-id',
      });
    });

    it('should return null when no credentials stored', async () => {
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(null);

      const result = await getCredentials();

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      vi.mocked(crossKeychain.getPassword).mockRejectedValue(new Error('Keychain error'));

      const result = await getCredentials();

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', async () => {
      vi.mocked(crossKeychain.getPassword).mockResolvedValue('not-valid-json');

      const result = await getCredentials();

      expect(result).toBeNull();
    });

    it('should handle credentials without accessToken', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'test-refresh-token',
        clientId: 'test-client-id',
      });

      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      const result = await getCredentials();

      expect(result).toEqual({
        refreshToken: 'test-refresh-token',
        accessToken: '',
        clientId: 'test-client-id',
      });
    });
  });

  describe('saveCredentials', () => {
    it('should save credentials to keychain', async () => {
      vi.mocked(crossKeychain.setPassword).mockResolvedValue(undefined);

      const creds: Credentials = {
        refreshToken: 'new-refresh-token',
        accessToken: 'new-access-token',
        clientId: 'new-client-id',
      };

      await saveCredentials(creds);

      expect(crossKeychain.setPassword).toHaveBeenCalledWith(
        'com.granola.cli',
        'credentials',
        JSON.stringify(creds),
      );
    });

    it('should throw on keychain error', async () => {
      vi.mocked(crossKeychain.setPassword).mockRejectedValue(new Error('Keychain error'));

      const creds: Credentials = {
        refreshToken: 'token',
        accessToken: 'access',
        clientId: 'client',
      };

      await expect(saveCredentials(creds)).rejects.toThrow('Keychain error');
    });
  });

  describe('deleteCredentials', () => {
    it('should delete credentials from keychain', async () => {
      vi.mocked(crossKeychain.deletePassword).mockResolvedValue(undefined);

      await deleteCredentials();

      expect(crossKeychain.deletePassword).toHaveBeenCalledWith('com.granola.cli', 'credentials');
    });

    it('should not throw if credentials do not exist', async () => {
      vi.mocked(crossKeychain.deletePassword).mockResolvedValue(undefined);

      await expect(deleteCredentials()).resolves.toBeUndefined();
    });
  });

  describe('parseSupabaseJson', () => {
    it('should parse valid Supabase JSON with WorkOS tokens', () => {
      const supabaseJson = {
        workos_tokens: JSON.stringify({
          access_token: 'workos-access-token',
          refresh_token: 'workos-refresh-token',
        }),
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'workos-refresh-token',
        accessToken: 'workos-access-token',
        clientId: 'client_GranolaMac',
      });
    });

    it('should fall back to Cognito tokens when WorkOS not available', () => {
      const supabaseJson = {
        cognito_tokens: JSON.stringify({
          refresh_token: 'cognito-refresh-token',
          access_token: 'cognito-access-token',
          client_id: 'cognito-client-id',
        }),
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'cognito-refresh-token',
        accessToken: 'cognito-access-token',
        clientId: 'cognito-client-id',
      });
    });

    it('should parse legacy format with root-level tokens', () => {
      const supabaseJson = {
        refresh_token: 'supabase-refresh-token',
        access_token: 'supabase-access-token',
        client_id: 'supabase-client-id',
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'supabase-refresh-token',
        accessToken: 'supabase-access-token',
        clientId: 'supabase-client-id',
      });
    });

    it('should return null for invalid JSON', () => {
      const result = parseSupabaseJson('not valid json');
      expect(result).toBeNull();
    });

    it('should return null for missing refresh_token in legacy format', () => {
      const supabaseJson = {
        client_id: 'supabase-client-id',
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));
      expect(result).toBeNull();
    });

    it('should handle missing client_id with default in legacy format', () => {
      const supabaseJson = {
        refresh_token: 'supabase-refresh-token',
        access_token: 'supabase-access-token',
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'supabase-refresh-token',
        accessToken: 'supabase-access-token',
        clientId: 'client_GranolaMac',
      });
    });

    it('should handle missing access_token in legacy format', () => {
      const supabaseJson = {
        refresh_token: 'supabase-refresh-token',
        client_id: 'supabase-client-id',
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'supabase-refresh-token',
        accessToken: '',
        clientId: 'supabase-client-id',
      });
    });

    it('should handle WorkOS tokens without refresh_token', () => {
      const supabaseJson = {
        workos_tokens: JSON.stringify({
          access_token: 'workos-access-token',
          client_id: 'workos-client-id',
        }),
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: '',
        accessToken: 'workos-access-token',
        clientId: 'workos-client-id',
      });
    });

    it('should handle WorkOS tokens without client_id', () => {
      const supabaseJson = {
        workos_tokens: JSON.stringify({
          access_token: 'workos-access-token',
          refresh_token: 'workos-refresh-token',
        }),
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'workos-refresh-token',
        accessToken: 'workos-access-token',
        clientId: 'client_GranolaMac',
      });
    });

    it('should handle Cognito tokens without access_token', () => {
      const supabaseJson = {
        cognito_tokens: JSON.stringify({
          refresh_token: 'cognito-refresh-token',
          client_id: 'cognito-client-id',
        }),
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'cognito-refresh-token',
        accessToken: '',
        clientId: 'cognito-client-id',
      });
    });

    it('should handle Cognito tokens without client_id', () => {
      const supabaseJson = {
        cognito_tokens: JSON.stringify({
          refresh_token: 'cognito-refresh-token',
          access_token: 'cognito-access-token',
        }),
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'cognito-refresh-token',
        accessToken: 'cognito-access-token',
        clientId: 'client_GranolaMac',
      });
    });
  });

  describe('parseStoredAccountsJson', () => {
    it('should parse stored accounts with stringified accounts and tokens', () => {
      const storedAccountsJson = {
        accounts: JSON.stringify({
          account1: {
            tokens: JSON.stringify({
              access_token: 'stored-access-token',
              refresh_token: 'stored-refresh-token',
              client_id: 'stored-client-id',
            }),
          },
        }),
      };

      const result = parseStoredAccountsJson(JSON.stringify(storedAccountsJson));

      expect(result).toEqual({
        refreshToken: 'stored-refresh-token',
        accessToken: 'stored-access-token',
        clientId: 'stored-client-id',
      });
    });

    it('should parse stored accounts with object-shaped accounts and tokens', () => {
      const storedAccountsJson = {
        accounts: {
          account1: {
            tokens: {
              access_token: 'stored-access-token',
              refresh_token: 'stored-refresh-token',
            },
          },
        },
      };

      const result = parseStoredAccountsJson(JSON.stringify(storedAccountsJson));

      expect(result).toEqual({
        refreshToken: 'stored-refresh-token',
        accessToken: 'stored-access-token',
        clientId: 'client_GranolaMac',
      });
    });

    it('should parse stored accounts with array-shaped accounts', () => {
      const storedAccountsJson = {
        accounts: [
          { email: 'first@example.com' },
          {
            tokens: {
              access_token: 'stored-access-token',
              refresh_token: 'stored-refresh-token',
              client_id: 'stored-client-id',
            },
          },
        ],
      };

      const result = parseStoredAccountsJson(JSON.stringify(storedAccountsJson));

      expect(result).toEqual({
        refreshToken: 'stored-refresh-token',
        accessToken: 'stored-access-token',
        clientId: 'stored-client-id',
      });
    });

    it('should return null for invalid stored accounts JSON', () => {
      expect(parseStoredAccountsJson('not valid json')).toBeNull();
    });
  });

  describe('default desktop paths', () => {
    it('should return macOS paths when on darwin', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');

      expect(getDefaultSupabasePath()).toBe(
        '/Users/testuser/Library/Application Support/Granola/supabase.json',
      );
      expect(getDefaultStoredAccountsPath()).toBe(
        '/Users/testuser/Library/Application Support/Granola/stored-accounts.json',
      );
    });

    it('should return Windows path using APPDATA when available', () => {
      vi.mocked(os.platform).mockReturnValue('win32');
      vi.mocked(os.homedir).mockReturnValue('C:\\Users\\testuser');
      const originalAppData = process.env.APPDATA;
      process.env.APPDATA = 'C:\\Users\\testuser\\AppData\\Roaming';

      const result = getDefaultSupabasePath();

      expect(result).toContain('Granola');
      expect(result).toContain('supabase.json');
      expect(result).toContain('AppData');

      process.env.APPDATA = originalAppData;
    });

    it('should return Windows path with fallback when APPDATA not set', () => {
      vi.mocked(os.platform).mockReturnValue('win32');
      vi.mocked(os.homedir).mockReturnValue('C:\\Users\\testuser');
      const originalAppData = process.env.APPDATA;
      delete process.env.APPDATA;

      const result = getDefaultSupabasePath();

      expect(result).toContain('Granola');
      expect(result).toContain('supabase.json');

      process.env.APPDATA = originalAppData;
    });

    it('should return Linux path for other platforms', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.mocked(os.homedir).mockReturnValue('/home/testuser');

      const result = getDefaultSupabasePath();

      expect(result).toBe('/home/testuser/.config/granola/supabase.json');
    });
  });

  describe('loadCredentialsFromFile', () => {
    it('should prefer stored accounts over supabase credentials', async () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');

      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (String(path).endsWith('stored-accounts.json')) {
          return JSON.stringify({
            accounts: {
              account1: {
                tokens: {
                  refresh_token: 'stored-refresh-token',
                  access_token: 'stored-access-token',
                  client_id: 'stored-client-id',
                },
              },
            },
          });
        }
        return JSON.stringify({
          refresh_token: 'supabase-refresh-token',
          access_token: 'supabase-access-token',
          client_id: 'supabase-client-id',
        });
      });

      const result = await loadCredentialsFromFile();

      expect(result).toMatchObject({
        credentials: {
          refreshToken: 'stored-refresh-token',
          accessToken: 'stored-access-token',
          clientId: 'stored-client-id',
        },
        sourceType: 'stored-accounts',
        sourcePath: '/Users/testuser/Library/Application Support/Granola/stored-accounts.json',
        warnings: [],
      });
    });

    it('should fall back to supabase when stored accounts cannot be parsed', async () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');

      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (String(path).endsWith('stored-accounts.json')) return 'not valid json';
        return JSON.stringify({
          refresh_token: 'supabase-refresh-token',
          access_token: 'supabase-access-token',
          client_id: 'supabase-client-id',
        });
      });

      const result = await loadCredentialsFromFile();

      expect(result).toMatchObject({
        credentials: {
          refreshToken: 'supabase-refresh-token',
          accessToken: 'supabase-access-token',
          clientId: 'supabase-client-id',
        },
        sourceType: 'supabase',
      });
    });

    it('should choose fresher supabase credentials over stale stored accounts', async () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');
      vi.mocked(fs.stat).mockImplementation(async (path) => {
        if (String(path).endsWith('stored-accounts.json')) return { mtimeMs: 1000 } as never;
        if (String(path).endsWith('supabase.json')) return { mtimeMs: 3000 } as never;
        if (String(path).endsWith('stored-accounts.json.enc')) return { mtimeMs: 2000 } as never;
        throw missingFileError();
      });
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (String(path).endsWith('stored-accounts.json')) {
          return JSON.stringify({
            accounts: {
              account1: {
                tokens: {
                  refresh_token: 'stored-refresh-token',
                  access_token: 'stored-access-token',
                  client_id: 'stored-client-id',
                },
              },
            },
          });
        }
        return JSON.stringify({
          refresh_token: 'supabase-refresh-token',
          access_token: 'supabase-access-token',
          client_id: 'supabase-client-id',
        });
      });

      const result = await loadCredentialsFromFile();

      expect(result).toMatchObject({
        credentials: {
          refreshToken: 'supabase-refresh-token',
          accessToken: 'supabase-access-token',
          clientId: 'supabase-client-id',
        },
        sourceType: 'supabase',
        warnings: [],
      });
    });

    it('should warn when imported plaintext is older than encrypted state', async () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');
      vi.mocked(fs.stat).mockImplementation(async (path) => {
        const mtimeMs = String(path).endsWith('stored-accounts.json.enc') ? 2000 : 1000;
        return { mtimeMs } as never;
      });
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (String(path).endsWith('stored-accounts.json')) {
          return JSON.stringify({
            accounts: {
              account1: {
                tokens: {
                  refresh_token: 'stored-refresh-token',
                  access_token: 'stored-access-token',
                },
              },
            },
          });
        }
        throw missingFileError();
      });

      const result = await loadCredentialsFromFile();

      expect(result?.warnings.join(' ')).toMatch(/older than encrypted/i);
    });

    it('should return null when files do not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const result = await loadCredentialsFromFile();

      expect(result).toBeNull();
    });

    it('should return null when files contain invalid JSON', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('not valid json');

      const result = await loadCredentialsFromFile();

      expect(result).toBeNull();
    });

    it('should not call mixed plaintext and encrypted state encrypted-only', async () => {
      vi.mocked(fs.stat).mockImplementation(async (path) => {
        if (
          String(path).endsWith('stored-accounts.json') ||
          String(path).endsWith('stored-accounts.json.enc')
        ) {
          return { mtimeMs: 1000 } as never;
        }
        throw missingFileError();
      });

      const message = await getAuthImportFailureMessage();

      expect(message).toMatch(/No supported plaintext credentials could be parsed/i);
      expect(message).not.toMatch(/encrypted.*not supported/i);
    });
  });

  describe('refreshAccessToken', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      globalThis.fetch = mockFetch;
      mockFetch.mockReset();
    });

    it('should refresh token and save new credentials', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);
      vi.mocked(crossKeychain.setPassword).mockResolvedValue(undefined);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
          }),
      });

      const result = await refreshAccessToken();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.workos.com/user_management/authenticate',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: 'test-client-id',
            grant_type: 'refresh_token',
            refresh_token: 'old-refresh-token',
          }),
          signal: expect.any(AbortSignal),
        }),
      );

      expect(result).toEqual({
        refreshToken: 'new-refresh-token',
        accessToken: 'new-access-token',
        clientId: 'test-client-id',
      });

      expect(crossKeychain.setPassword).toHaveBeenCalledWith(
        'com.granola.cli',
        'credentials',
        JSON.stringify({
          refreshToken: 'new-refresh-token',
          accessToken: 'new-access-token',
          clientId: 'test-client-id',
        }),
      );
    });

    it('should return null when no credentials stored', async () => {
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(null);

      const result = await refreshAccessToken();

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null when missing refreshToken', async () => {
      const storedCreds = JSON.stringify({
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      const result = await refreshAccessToken();

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null when missing clientId', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      const result = await refreshAccessToken();

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null when WorkOS returns error', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await refreshAccessToken();

      expect(result).toBeNull();
      expect(crossKeychain.setPassword).not.toHaveBeenCalled();
    });

    it('should return server rejection metadata when WorkOS returns error', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      const result = await refreshAccessTokenWithResult();

      expect(result).toEqual({
        ok: false,
        reason: 'server_rejected',
        status: 400,
        statusText: 'Bad Request',
      });
      expect(crossKeychain.setPassword).not.toHaveBeenCalled();
    });

    it('should report save failure separately from invalid refresh response', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);
      vi.mocked(crossKeychain.setPassword).mockRejectedValue(new Error('Keychain locked'));

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
          }),
      });

      const result = await refreshAccessTokenWithResult();

      expect(result).toEqual({ ok: false, reason: 'save_failed' });
      expect(crossKeychain.setPassword).toHaveBeenCalledWith(
        'com.granola.cli',
        'credentials',
        JSON.stringify({
          refreshToken: 'new-refresh-token',
          accessToken: 'new-access-token',
          clientId: 'test-client-id',
        }),
      );
    });

    it('should return null when the refresh request times out', async () => {
      vi.useFakeTimers();
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);
      mockFetch.mockImplementation((_url, options) => {
        const signal = (options as RequestInit).signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      });

      const resultPromise = refreshAccessTokenWithResult();
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;

      expect(result).toEqual({ ok: false, reason: 'network_error' });
      expect(crossKeychain.setPassword).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should keep the refresh timeout active while parsing the response body', async () => {
      vi.useFakeTimers();
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);
      mockFetch.mockImplementation((_url, options) => {
        const signal = (options as RequestInit).signal;
        return Promise.resolve({
          ok: true,
          json: () =>
            new Promise((_resolve, reject) => {
              signal?.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError')),
              );
            }),
        });
      });

      const resultPromise = refreshAccessTokenWithResult();
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;

      expect(result).toEqual({ ok: false, reason: 'network_error' });
      expect(crossKeychain.setPassword).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should return null on network error', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await refreshAccessToken();

      expect(result).toBeNull();
      expect(crossKeychain.setPassword).not.toHaveBeenCalled();
    });

    it('should use file lock to prevent race conditions', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);
      vi.mocked(crossKeychain.setPassword).mockResolvedValue(undefined);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
          }),
      });

      await refreshAccessToken();

      expect(withLock).toHaveBeenCalledTimes(1);
      expect(withLock).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should return null when lock acquisition fails', async () => {
      vi.mocked(withLock).mockRejectedValueOnce(new Error('Failed to acquire token refresh lock'));

      const result = await refreshAccessToken();

      expect(result).toBeNull();
    });
  });
});
