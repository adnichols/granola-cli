# Security

## Overview

This document describes Granola CLI's security architecture, including credential handling, data storage, and security measures in place.

## Authentication & Credential Storage

### Keychain Integration

Granola CLI uses platform-native secure storage for credentials via the `cross-keychain` library:

- **macOS**: Keychain
- **Windows**: Credential Manager
- **Linux**: Secret Service

**Storage Details:**
- Service name: `com.granola.cli`
- Account: `credentials`
- Format: JSON containing `refreshToken`, `accessToken`, and `clientId`

### Credential Import

The CLI supports importing plaintext credentials from the Granola desktop application:

- **Preferred source**: `~/Library/Application Support/Granola/stored-accounts.json`
- **Legacy fallback**: `~/Library/Application Support/Granola/supabase.json`
- **Process**: Parses supported token fields, records source metadata, and stores credentials in the system keychain

Modern Granola desktop installs may expose only encrypted current state, such as `stored-accounts.json.enc`, `supabase.json.enc`, `cache-v6.json.enc`, and `storage.dek`. This CLI performs metadata-only inspection of those files for diagnostics: existence, file names, and relative freshness. It does **not** decrypt encrypted desktop state, read decrypted payloads, log tokens, or persist decrypted state outside the existing keychain credential boundary.

If plaintext credentials are older than encrypted state, `auth login` labels the import as possibly stale/import-only unless a later API command validates the credentials.

### Token Refresh

The CLI automatically handles token expiration:

**Location**: `lib/auth.ts`, `lib/lock.ts`, `services/client.ts`

**How it works:**
- `refreshAccessTokenWithResult()` calls the legacy WorkOS API to refresh expired tokens and preserves failure reasons
- `withTokenRefresh()` wrapper automatically retries operations on 401 errors when refresh succeeds
- All API-calling service methods are wrapped with automatic token refresh
- New credentials are saved immediately after refresh
- If refresh is rejected, the CLI reports a targeted diagnostic instead of silently masking it as a generic login retry

**Token Rotation Flow:**
1. API call fails with 401 (Unauthorized)
2. `withTokenRefresh` catches the error and calls `refreshAccessTokenWithResult()`
3. File-based lock is acquired to prevent race conditions (via `lib/lock.ts`)
4. Credentials are re-read inside the lock (another process may have updated them)
5. CLI sends refresh request to `https://api.workos.com/user_management/authenticate`
6. WorkOS returns new `access_token` and rotated `refresh_token`, or rejects the refresh token
7. On success, new credentials are saved to keychain
8. Lock is released
9. Original operation is retried with fresh token, or a refresh-failed diagnostic is surfaced

**Important**: WorkOS refresh tokens are **single-use**. Each refresh invalidates the previous token and issues a new one. The CLI uses file-based locking to prevent race conditions when multiple CLI processes attempt to refresh the token simultaneously.

### Race Condition Prevention

**Location**: `lib/lock.ts`

When multiple CLI processes run concurrently (e.g., in scripts), they may both encounter expired tokens and attempt to refresh simultaneously. Without protection, this causes a race condition:
1. Process A reads refresh token T1
2. Process B reads refresh token T1
3. Process A refreshes and invalidates T1, gets T2
4. Process B tries to refresh with T1 (now invalid) and fails

The CLI prevents this using file-based locking:
- Lock file: `~/Library/Caches/granola/granola-token-refresh.lock` (macOS) or system temp dir
- Uses `O_CREAT | O_EXCL` for atomic lock acquisition
- 30-second timeout waiting for lock
- Stale lock cleanup after 60 seconds
- Credentials are re-read inside the lock to use any updates from other processes

## Configuration Storage

Non-sensitive configuration is stored using the `conf` library:

- **Linux**: `~/.config/granola/`
- **macOS**: `~/Library/Application Support/granola/`
- **Format**: Plaintext JSON (non-sensitive data only)

## Security Measures

### Pager Command Validation

**Location**: `lib/pager.ts`

The CLI validates pager commands to prevent command injection:

- Whitelist of allowed pagers: `less`, `more`, `cat`, `head`, `tail`, `bat`, `most`
- Blocks commands containing shell metacharacters (`;`, `|`, `&`, `$`, `` ` ``, etc.)
- Falls back to direct stdout output if pager command is invalid

```typescript
const ALLOWED_PAGERS = ['less', 'more', 'cat', 'head', 'tail', 'bat', 'most'];
const SHELL_METACHARACTERS = /[;&|`$(){}[\]<>\\!#*?]/;

export function validatePagerCommand(cmd: string): boolean {
  if (SHELL_METACHARACTERS.test(cmd)) return false;
  const [binary] = cmd.split(' ');
  const binaryName = binary.split('/').pop() || '';
  return ALLOWED_PAGERS.includes(binaryName);
}
```

### Alias Command Validation

**Location**: `lib/config.ts`, `lib/alias.ts`

Aliases are validated to prevent command injection:

- `parseAliasArguments()` wrapper around `shell-quote`
- `validateAliasCommand()` rejects pipelines, redirects, or substitution syntax
- Quoted arguments are supported, but only literal argv tokens reach Commander

```typescript
export function parseAliasArguments(command: string): string[] {
  const parsed = parseShellQuote(command);
  if (parsed.length === 0) throw new Error('Alias cannot be empty');
  if (parsed.some((token) => typeof token !== 'string')) {
    throw new Error('Alias command contains unsupported shell syntax.');
  }
  return parsed as string[];
}
```

### Debug Logging

**Location**: `lib/auth.ts`

Authentication errors are logged via the [`debug`](https://www.npmjs.com/package/debug) library:

- Developers can inspect credential-loading issues by enabling `granola:*` namespaces
- Use `DEBUG` or `GRANOLA_DEBUG` environment variables
- Maintains graceful degradation (returns null for non-blocking errors)

Example:

```bash
DEBUG=granola:lib:auth granola auth status
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Authentication required |
| 4 | Resource not found |

## Security Best Practices for Users

- **Never share your refresh token**: Your refresh token provides long-term access to your account.

- **Logout on shared machines**: Always run `granola auth logout` when finished using the CLI on shared or public computers.

- **Be cautious with environment variables**: Avoid setting `GRANOLA_PAGER` to untrusted values or commands from unknown sources.

- **Keep the CLI updated**: Regularly update to the latest version to receive security patches and improvements.

- **Review stored credentials**: Periodically verify that credentials are stored securely in your system's keychain.

## Reporting Security Vulnerabilities

If you discover a security vulnerability in Granola CLI, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Contact the maintainers privately
3. Provide detailed information about the vulnerability
4. Allow reasonable time for a fix before public disclosure

## Additional Resources

- [OWASP Command Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html)
- [Secure Credential Storage Best Practices](https://www.owasp.org/index.php/Password_Storage_Cheat_Sheet)
