import chalk from 'chalk';
import { createApiClient, type GranolaApi } from '../lib/api.js';
import { getCredentials, refreshAccessTokenWithResult } from '../lib/auth.js';
import { createGranolaDebug, maskToken } from '../lib/debug.js';
import { AuthRecoveryError } from '../lib/errors.js';
import { createHttpClient } from '../lib/http.js';

const debug = createGranolaDebug('service:client');

let client: GranolaApi | null = null;

export async function getClient(): Promise<GranolaApi> {
  debug('getClient called, cached: %s', client ? 'yes' : 'no');
  if (client) return client;

  debug('fetching credentials');
  const creds = await getCredentials();
  if (!creds) {
    debug('no credentials found, exiting');
    console.error(chalk.red('Error:'), 'Not authenticated.');
    console.error(`Run ${chalk.cyan('granola auth login')} to authenticate.`);
    process.exit(2);
  }

  debug('creating API client, token: %s', maskToken(creds.accessToken));
  const httpClient = createHttpClient(creds.accessToken);
  client = createApiClient(httpClient);

  return client;
}

export function resetClient(): void {
  debug('client reset');
  client = null;
}

function isUnauthorizedError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const e = error as { status?: number };
    return e.status === 401;
  }
  return false;
}

function formatRefreshFailureDetails(
  result: Exclude<Awaited<ReturnType<typeof refreshAccessTokenWithResult>>, { ok: true }>,
): string[] {
  const details = ['The CLI attempted to refresh the stored access token before stopping.'];

  switch (result.reason) {
    case 'server_rejected': {
      const status = result.status ? ` (${result.status} ${result.statusText || ''})`.trim() : '';
      details.push(`Granola/WorkOS rejected the refresh token${status}.`);
      details.push('The imported desktop plaintext credentials may be stale or no longer valid.');
      details.push(
        'Run granola auth login once to re-import supported plaintext credentials; if it reports stale plaintext or encrypted-only state, rerunning login may not help.',
      );
      break;
    }
    case 'missing_credentials':
      details.push('No credentials were found in the CLI keychain. Run granola auth login.');
      break;
    case 'missing_refresh_token':
      details.push('Stored credentials do not include a refresh token. Run granola auth login.');
      break;
    case 'missing_client_id':
      details.push('Stored credentials do not include a client id. Run granola auth login.');
      break;
    case 'network_error':
      details.push(
        'The refresh request failed due to a network error. Check your connection and retry.',
      );
      break;
    case 'invalid_response':
      details.push(
        'The refresh endpoint returned an unexpected response without replacement tokens.',
      );
      break;
    case 'lock_error':
      details.push(
        'The CLI could not acquire the token refresh lock. Retry after other granola commands finish.',
      );
      break;
  }

  return details;
}

/**
 * Wraps an async operation with automatic token refresh on 401 errors.
 * If the operation fails with a 401, attempts to refresh the token and retry once.
 */
export async function withTokenRefresh<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (isUnauthorizedError(error)) {
      debug('401 detected, attempting token refresh');

      const refreshResult = await refreshAccessTokenWithResult();
      if (!refreshResult.ok) {
        debug('token refresh failed with reason: %s', refreshResult.reason);
        throw new AuthRecoveryError(
          'Authentication required; token refresh failed.',
          formatRefreshFailureDetails(refreshResult),
        );
      }

      resetClient();
      debug('retrying operation with refreshed token');
      return operation();
    }
    throw error;
  }
}
