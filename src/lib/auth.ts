import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deletePassword, getPassword, setPassword } from 'cross-keychain';
import type { Credentials } from '../types.js';
import { createGranolaDebug } from './debug.js';
import {
  describeDesktopState,
  type GranolaDesktopState,
  getDefaultGranolaStateDirectory,
  hasAnyDesktopState,
  hasEncryptedState,
  inspectGranolaDesktopState,
  isPlaintextStaleRelativeToEncrypted,
} from './granola-desktop-state.js';
import { withLock } from './lock.js';

const debug = createGranolaDebug('lib:auth');

const SERVICE_NAME = 'com.granola.cli';
const ACCOUNT_NAME = 'credentials';
const DEFAULT_CLIENT_ID = 'client_GranolaMac';
const WORKOS_AUTH_URL = 'https://api.workos.com/user_management/authenticate';

export type CredentialSourceType = 'stored-accounts' | 'supabase';

export interface CredentialImportResult {
  credentials: Credentials;
  sourcePath: string;
  sourceType: CredentialSourceType;
  warnings: string[];
  desktopState: GranolaDesktopState;
}

export type RefreshFailureReason =
  | 'missing_credentials'
  | 'missing_refresh_token'
  | 'missing_client_id'
  | 'server_rejected'
  | 'network_error'
  | 'lock_error'
  | 'invalid_response';

export type RefreshAccessTokenResult =
  | { ok: true; credentials: Credentials }
  | { ok: false; reason: RefreshFailureReason; status?: number; statusText?: string };

export async function getCredentials(): Promise<Credentials | null> {
  debug('loading credentials from keychain');
  try {
    const stored = await getPassword(SERVICE_NAME, ACCOUNT_NAME);
    if (!stored) {
      debug('no credentials found in keychain');
      return null;
    }

    const parsed = JSON.parse(stored);
    debug('credentials loaded, hasAccessToken: %s', Boolean(parsed.accessToken));
    return {
      refreshToken: parsed.refreshToken,
      accessToken: parsed.accessToken || '',
      clientId: parsed.clientId,
    };
  } catch (error) {
    debug('failed to get credentials: %O', error);
    return null;
  }
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  debug('saving credentials to keychain');
  await setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(creds));
  debug('credentials saved');
}

export async function deleteCredentials(): Promise<void> {
  debug('deleting credentials from keychain');
  await deletePassword(SERVICE_NAME, ACCOUNT_NAME);
  debug('credentials deleted');
}

/**
 * Refreshes the access token using the stored refresh token.
 * WorkOS refresh tokens are single-use - each refresh returns a new refresh token
 * that must be saved immediately.
 *
 * Uses a file-based lock to prevent race conditions when multiple CLI processes
 * attempt to refresh the token simultaneously.
 */
export async function refreshAccessTokenWithResult(): Promise<RefreshAccessTokenResult> {
  debug('attempting token refresh');

  try {
    return await withLock(async () => {
      const creds = await getCredentials();
      if (!creds) {
        debug('cannot refresh: missing credentials');
        return { ok: false, reason: 'missing_credentials' };
      }
      if (!creds.refreshToken) {
        debug('cannot refresh: missing refreshToken');
        return { ok: false, reason: 'missing_refresh_token' };
      }
      if (!creds.clientId) {
        debug('cannot refresh: missing clientId');
        return { ok: false, reason: 'missing_client_id' };
      }

      let response: Response;
      try {
        response = await fetch(WORKOS_AUTH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: creds.clientId,
            grant_type: 'refresh_token',
            refresh_token: creds.refreshToken,
          }),
        });
      } catch (error) {
        debug('token refresh network error: %O', error);
        return { ok: false, reason: 'network_error' };
      }

      if (!response.ok) {
        debug('token refresh failed: %d %s', response.status, response.statusText);
        return {
          ok: false,
          reason: 'server_rejected',
          status: response.status,
          statusText: response.statusText,
        };
      }

      try {
        const data = (await response.json()) as { refresh_token?: string; access_token?: string };
        if (!data.access_token || !data.refresh_token) {
          debug('token refresh response missing token fields');
          return { ok: false, reason: 'invalid_response' };
        }

        const newCreds: Credentials = {
          refreshToken: data.refresh_token,
          accessToken: data.access_token,
          clientId: creds.clientId,
        };

        await saveCredentials(newCreds);
        debug('token refresh successful, new credentials saved');
        return { ok: true, credentials: newCreds };
      } catch (error) {
        debug('token refresh invalid response: %O', error);
        return { ok: false, reason: 'invalid_response' };
      }
    });
  } catch (error) {
    debug('token refresh lock error: %O', error);
    return { ok: false, reason: 'lock_error' };
  }
}

/**
 * Backwards-compatible token refresh helper.
 * Prefer refreshAccessTokenWithResult() when diagnostics matter.
 */
export async function refreshAccessToken(): Promise<Credentials | null> {
  const result = await refreshAccessTokenWithResult();
  return result.ok ? result.credentials : null;
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function tokensToCredentials(tokens: unknown): Credentials | null {
  if (!tokens || typeof tokens !== 'object') return null;
  const data = tokens as Record<string, unknown>;
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  const clientId = data.client_id;

  if (typeof accessToken !== 'string' && typeof refreshToken !== 'string') return null;

  return {
    refreshToken: typeof refreshToken === 'string' ? refreshToken : '',
    accessToken: typeof accessToken === 'string' ? accessToken : '',
    clientId: typeof clientId === 'string' ? clientId : DEFAULT_CLIENT_ID,
  };
}

function findCredentialsInAccount(account: unknown): Credentials | null {
  const parsedAccount = parseMaybeJson(account);
  if (!parsedAccount || typeof parsedAccount !== 'object') return null;
  const data = parsedAccount as Record<string, unknown>;

  const direct = tokensToCredentials(data);
  if (direct) return direct;

  const tokenCandidates = [data.tokens, data.workos_tokens, data.cognito_tokens];
  for (const candidate of tokenCandidates) {
    const credentials = tokensToCredentials(parseMaybeJson(candidate));
    if (credentials) return credentials;
  }

  return null;
}

export function parseStoredAccountsJson(json: string): Credentials | null {
  debug('parsing stored-accounts.json');
  try {
    const parsed = parseJson(json);
    const root = parseMaybeJson(parsed) as Record<string, unknown>;
    if (!root || typeof root !== 'object') return null;

    const rootCredentials = findCredentialsInAccount(root);
    if (rootCredentials) {
      debug('found stored account tokens at root');
      return rootCredentials;
    }

    const accounts = parseMaybeJson(root.accounts);
    const accountValues = Array.isArray(accounts)
      ? accounts
      : accounts && typeof accounts === 'object'
        ? Object.values(accounts)
        : [];

    for (const account of accountValues) {
      const credentials = findCredentialsInAccount(account);
      if (credentials) {
        debug('found stored account tokens');
        return credentials;
      }
    }

    return null;
  } catch (error) {
    debug('failed to parse stored-accounts.json: %O', error);
    return null;
  }
}

export function parseSupabaseJson(json: string): Credentials | null {
  debug('parsing supabase.json');
  try {
    const parsed = parseJson(json) as Record<string, unknown>;

    const workosCredentials = tokensToCredentials(parseMaybeJson(parsed.workos_tokens));
    if (workosCredentials?.accessToken) {
      debug('found WorkOS tokens');
      return workosCredentials;
    }

    const cognitoCredentials = tokensToCredentials(parseMaybeJson(parsed.cognito_tokens));
    if (cognitoCredentials?.refreshToken) {
      debug('found Cognito tokens');
      return cognitoCredentials;
    }

    const legacyCredentials = tokensToCredentials(parsed);
    if (!legacyCredentials?.refreshToken) return null;

    debug('found legacy token format');
    return legacyCredentials;
  } catch (error) {
    debug('failed to parse supabase.json: %O', error);
    return null;
  }
}

export function getDefaultStoredAccountsPath(): string {
  return join(getDefaultGranolaStateDirectory(), 'stored-accounts.json');
}

/**
 * Gets the default path to the Granola supabase.json file based on the OS.
 */
export function getDefaultSupabasePath(): string {
  return join(getDefaultGranolaStateDirectory(), 'supabase.json');
}

async function readCredentialsFile(
  path: string,
  sourceType: CredentialSourceType,
): Promise<Credentials | null> {
  try {
    debug('loading credentials from file: %s', path);
    const content = await readFile(path, 'utf-8');
    return sourceType === 'stored-accounts'
      ? parseStoredAccountsJson(content)
      : parseSupabaseJson(content);
  } catch (error) {
    debug('failed to load credentials from %s: %O', path, error);
    return null;
  }
}

function buildImportWarnings(
  sourceType: CredentialSourceType,
  state: GranolaDesktopState,
): string[] {
  const sourceFile = sourceType === 'stored-accounts' ? 'stored-accounts.json' : 'supabase.json';
  if (!isPlaintextStaleRelativeToEncrypted(state, sourceFile)) return [];

  return [
    `${sourceFile} is older than encrypted Granola desktop state. Imported credentials may be stale; treating this as an import-only result unless an API command validates them.`,
  ];
}

/**
 * Loads credentials from the default Granola desktop credential files.
 * Prefers stored-accounts.json, then falls back to legacy supabase.json.
 */
export async function loadCredentialsFromFile(): Promise<CredentialImportResult | null> {
  const desktopState = await inspectGranolaDesktopState();
  const candidates: Array<{ path: string; sourceType: CredentialSourceType }> = [
    { path: getDefaultStoredAccountsPath(), sourceType: 'stored-accounts' },
    { path: getDefaultSupabasePath(), sourceType: 'supabase' },
  ];

  for (const candidate of candidates) {
    const credentials = await readCredentialsFile(candidate.path, candidate.sourceType);
    if (credentials) {
      return {
        credentials,
        sourcePath: candidate.path,
        sourceType: candidate.sourceType,
        warnings: buildImportWarnings(candidate.sourceType, desktopState),
        desktopState,
      };
    }
  }

  if (!hasAnyDesktopState(desktopState)) {
    debug('no Granola desktop state found');
  } else if (hasEncryptedState(desktopState)) {
    debug('encrypted Granola desktop state found without supported plaintext credentials');
  }

  return null;
}

export async function getAuthImportFailureMessage(): Promise<string> {
  const state = await inspectGranolaDesktopState();
  if (!hasAnyDesktopState(state)) {
    return 'No Granola desktop auth state was found. Install Granola desktop and sign in, then run granola auth login again.';
  }
  if (hasEncryptedState(state)) {
    return `${describeDesktopState(state)} Current Granola desktop state appears encrypted and is not supported by this CLI yet.`;
  }
  return `${describeDesktopState(state)} No supported plaintext credentials could be parsed.`;
}
