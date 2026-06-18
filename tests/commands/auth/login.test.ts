import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoginCommand } from '../../../src/commands/auth/login.js';
import { captureConsole } from '../../setup.js';

vi.mock('../../../src/lib/auth.js', () => ({
  saveCredentials: vi.fn(),
  loadCredentialsFromFile: vi.fn(),
  getDefaultStoredAccountsPath: vi.fn(() => '/mock/path/stored-accounts.json'),
  getDefaultSupabasePath: vi.fn(() => '/mock/path/supabase.json'),
  getAuthImportFailureMessage: vi.fn(() =>
    Promise.resolve('No Granola desktop auth state was found.'),
  ),
}));

import * as auth from '../../../src/lib/auth.js';

const mockDesktopState = { directory: '/mock/path', files: [] };

describe('login command', () => {
  let console_: ReturnType<typeof captureConsole>;
  let mockExit: any;

  beforeEach(() => {
    vi.clearAllMocks();
    console_ = captureConsole();
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    console_.restore();
    mockExit.mockRestore();
  });

  it('should import credentials from desktop app and report source', async () => {
    vi.mocked(auth.loadCredentialsFromFile).mockResolvedValue({
      credentials: {
        refreshToken: 'token',
        accessToken: 'access',
        clientId: 'client',
      },
      sourcePath: '/mock/path/stored-accounts.json',
      sourceType: 'stored-accounts',
      warnings: [],
      desktopState: mockDesktopState,
    });

    const program = new Command();
    program.addCommand(createLoginCommand());
    await program.parseAsync(['node', 'test', 'login']);

    expect(auth.loadCredentialsFromFile).toHaveBeenCalled();
    expect(auth.saveCredentials).toHaveBeenCalledWith({
      refreshToken: 'token',
      accessToken: 'access',
      clientId: 'client',
    });
    expect(console_.logs.some((log) => /Credentials imported successfully/i.test(log))).toBe(true);
    expect(console_.logs.some((log) => /stored-accounts\.json/i.test(log))).toBe(true);
  });

  it('should label stale plaintext imports without unqualified success', async () => {
    vi.mocked(auth.loadCredentialsFromFile).mockResolvedValue({
      credentials: {
        refreshToken: 'token',
        accessToken: 'access',
        clientId: 'client',
      },
      sourcePath: '/mock/path/supabase.json',
      sourceType: 'supabase',
      warnings: ['supabase.json is older than encrypted Granola desktop state.'],
      desktopState: mockDesktopState,
    });

    const program = new Command();
    program.addCommand(createLoginCommand());
    await program.parseAsync(['node', 'test', 'login']);

    expect(auth.saveCredentials).toHaveBeenCalled();
    expect(console_.logs.some((log) => /may be stale/i.test(log))).toBe(true);
    expect(console_.logs.some((log) => /^Credentials imported successfully$/i.test(log))).toBe(
      false,
    );
  });

  it('should exit with code 1 when credentials not found', async () => {
    vi.mocked(auth.loadCredentialsFromFile).mockResolvedValue(null);

    const program = new Command();
    program.addCommand(createLoginCommand());

    await expect(program.parseAsync(['node', 'test', 'login'])).rejects.toThrow('process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(
      console_.errors.some((log) => /Could not load supported plaintext credentials/i.test(log)),
    ).toBe(true);
  });

  it('should show both supported plaintext paths in error message when credentials not found', async () => {
    vi.mocked(auth.loadCredentialsFromFile).mockResolvedValue(null);

    const program = new Command();
    program.addCommand(createLoginCommand());

    await expect(program.parseAsync(['node', 'test', 'login'])).rejects.toThrow('process.exit');
    expect(console_.errors.some((log) => /\/mock\/path\/stored-accounts\.json/i.test(log))).toBe(
      true,
    );
    expect(console_.errors.some((log) => /\/mock\/path\/supabase\.json/i.test(log))).toBe(true);
  });

  it('should show encrypted-only diagnostics when no supported plaintext credentials parse', async () => {
    vi.mocked(auth.loadCredentialsFromFile).mockResolvedValue(null);
    vi.mocked(auth.getAuthImportFailureMessage).mockResolvedValue(
      'Found Granola desktop auth state files: stored-accounts.json.enc. Current Granola desktop state appears encrypted and is not supported by this CLI yet.',
    );

    const program = new Command();
    program.addCommand(createLoginCommand());

    await expect(program.parseAsync(['node', 'test', 'login'])).rejects.toThrow('process.exit');
    expect(console_.errors.some((log) => /encrypted/i.test(log))).toBe(true);
    expect(console_.errors.some((log) => /stored-accounts\.json\.enc/i.test(log))).toBe(true);
  });
});
