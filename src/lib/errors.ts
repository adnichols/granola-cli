import chalk from 'chalk';
import { ApiError } from './http.js';

export class AuthRecoveryError extends Error {
  constructor(
    message: string,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'AuthRecoveryError';
  }
}

/**
 * Handles global errors from CLI execution.
 * Returns the appropriate exit code.
 */
export function handleGlobalError(error: unknown): number {
  if (error instanceof AuthRecoveryError) {
    console.error(chalk.red('Error:'), error.message);
    for (const detail of error.details) {
      console.error(detail);
    }
    return 2;
  }

  if (error instanceof ApiError) {
    if (error.status === 401) {
      console.error(chalk.red('Error:'), 'Authentication required.');
      console.error('Stored credentials were rejected by Granola.');
      console.error(
        `Run ${chalk.cyan('granola auth login')} to import supported desktop credentials.`,
      );
      console.error(
        'If login reports stale plaintext or encrypted-only state, rerunning login may not fix authentication.',
      );
      return 2;
    }
    console.error(chalk.red('Error:'), error.message);
    return 1;
  }

  if (error instanceof Error && error.message.includes('fetch failed')) {
    console.error(chalk.red('Error:'), 'Network error. Check your connection.');
    return 1;
  }

  if (error instanceof Error) {
    console.error(chalk.red('Error:'), error.message || 'An unexpected error occurred.');
  } else {
    console.error(chalk.red('Error:'), 'An unexpected error occurred.');
  }
  return 1;
}
