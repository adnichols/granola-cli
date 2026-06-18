import { vi } from 'vitest';

process.env.TZ = 'UTC';

// Mock cross-keychain
vi.mock('cross-keychain', () => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
}));

// Mock conf
vi.mock('conf', () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    store: {},
  })),
}));

// Mock open
vi.mock('open', () => ({
  default: vi.fn(),
}));

// Utility to capture console output
export function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };

  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };

  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

// Utility to mock process.exit
export function mockProcessExit() {
  const exitCodes: number[] = [];
  const originalExit = process.exit;

  process.exit = ((code?: number) => {
    exitCodes.push(code ?? 0);
    throw new Error(`process.exit(${code})`);
  }) as never;

  return {
    exitCodes,
    restore: () => {
      process.exit = originalExit;
    },
  };
}
