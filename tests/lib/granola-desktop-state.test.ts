import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/Users/testuser'),
  platform: vi.fn(() => 'darwin'),
}));

import * as fs from 'node:fs/promises';
import {
  describeDesktopState,
  getDefaultGranolaStateDirectory,
  getExistingFileNames,
  hasAnyDesktopState,
  hasEncryptedState,
  hasSupportedPlaintextState,
  inspectGranolaDesktopState,
  isPlaintextStaleRelativeToEncrypted,
} from '../../src/lib/granola-desktop-state.js';

describe('granola desktop state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the macOS Granola state directory', () => {
    expect(getDefaultGranolaStateDirectory()).toBe(
      '/Users/testuser/Library/Application Support/Granola',
    );
  });

  it('should report no desktop state when no files exist', async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

    const state = await inspectGranolaDesktopState('/tmp/granola');

    expect(hasAnyDesktopState(state)).toBe(false);
    expect(hasEncryptedState(state)).toBe(false);
    expect(hasSupportedPlaintextState(state)).toBe(false);
    expect(describeDesktopState(state)).toMatch(/No Granola desktop auth state/i);
  });

  it('should report encrypted-only state without plaintext support', async () => {
    vi.mocked(fs.stat).mockImplementation(async (path) => {
      if (String(path).endsWith('stored-accounts.json.enc')) return { mtimeMs: 2000 } as never;
      if (String(path).endsWith('cache-v6.json.enc')) return { mtimeMs: 2000 } as never;
      throw new Error('ENOENT');
    });

    const state = await inspectGranolaDesktopState('/tmp/granola');

    expect(hasAnyDesktopState(state)).toBe(true);
    expect(hasEncryptedState(state)).toBe(true);
    expect(hasSupportedPlaintextState(state)).toBe(false);
    expect(getExistingFileNames(state)).toEqual(['stored-accounts.json.enc', 'cache-v6.json.enc']);
  });

  it('should not treat cache-v6.json as supported plaintext credentials', async () => {
    vi.mocked(fs.stat).mockImplementation(async (path) => {
      if (String(path).endsWith('cache-v6.json')) return { mtimeMs: 1000 } as never;
      throw new Error('ENOENT');
    });

    const state = await inspectGranolaDesktopState('/tmp/granola');

    expect(hasAnyDesktopState(state)).toBe(true);
    expect(hasSupportedPlaintextState(state)).toBe(false);
    expect(getExistingFileNames(state)).toEqual(['cache-v6.json']);
  });

  it('should detect plaintext older than encrypted sibling state', async () => {
    vi.mocked(fs.stat).mockImplementation(async (path) => {
      if (String(path).endsWith('stored-accounts.json')) return { mtimeMs: 1000 } as never;
      if (String(path).endsWith('stored-accounts.json.enc')) return { mtimeMs: 3000 } as never;
      throw new Error('ENOENT');
    });

    const state = await inspectGranolaDesktopState('/tmp/granola');

    expect(hasSupportedPlaintextState(state)).toBe(true);
    expect(isPlaintextStaleRelativeToEncrypted(state, 'stored-accounts.json')).toBe(true);
  });

  it('should not mark plaintext stale when encrypted state is older', async () => {
    vi.mocked(fs.stat).mockImplementation(async (path) => {
      if (String(path).endsWith('stored-accounts.json')) return { mtimeMs: 3000 } as never;
      if (String(path).endsWith('stored-accounts.json.enc')) return { mtimeMs: 1000 } as never;
      throw new Error('ENOENT');
    });

    const state = await inspectGranolaDesktopState('/tmp/granola');

    expect(isPlaintextStaleRelativeToEncrypted(state, 'stored-accounts.json')).toBe(false);
  });
});
