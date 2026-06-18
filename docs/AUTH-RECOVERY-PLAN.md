# Granola CLI Auth Recovery Plan

## Status

Research-ready, with one execution-ready first phase.

The legacy plaintext-auth repair is straightforward. The encrypted desktop-state repair is plausible but needs focused investigation before it should be implemented in this CLI.

## Goal

Make `granola auth login` and subsequent API commands behave correctly against modern Granola desktop installs, or fail with an accurate diagnostic when the installed desktop app exposes only encrypted state that this CLI cannot safely read.

## Why this plan exists

On modern Granola desktop builds, `granola auth login` can print `Credentials imported successfully` while `granola meeting list` immediately fails with `Authentication required`.

The CLI currently treats "a credential file was parsed and saved" as a successful login. In the observed failure mode, that file is stale plaintext left behind by an older Granola desktop storage format.

## Authority and Inputs

- Local `granola-cli` repository at `~/code/granola-cli`
- Installed npm CLI: `granola-cli@0.2.0`
- Local Granola desktop: `7.324.2`
- Upstream issue: `https://github.com/magarcia/granola-cli/issues/7`
- Upstream PR: `https://github.com/magarcia/granola-cli/pull/6`
- Related encrypted-state diagnostic issue in `graincrawl`: `https://github.com/openclaw/graincrawl/issues/15`
- Local app bundle companion CLI: `/Applications/Granola.app/Contents/Resources/bin/granola`

No token, refresh token, decrypted state, DEK, or keychain secret should be logged or committed while executing this plan.

## Current Implementation Reality

The CLI is a TypeScript ESM Commander app. Auth behavior lives mainly in:

- `src/lib/auth.ts`
- `src/services/client.ts`
- `src/commands/auth/login.ts`
- `src/commands/auth/status.ts`
- `tests/lib/auth.test.ts`
- `tests/commands/auth/login.test.ts`

Current behavior:

- `auth login` reads only `~/Library/Application Support/Granola/supabase.json` on macOS.
- Parsed credentials are saved under keychain service `com.granola.cli`, account `credentials`.
- `auth status` reports authenticated when any credential payload exists; it does not validate server usability.
- On 401, the client attempts refresh through WorkOS directly at `https://api.workos.com/user_management/authenticate`.

Observed local state:

- `supabase.json` was last updated on May 12, 2026.
- `stored-accounts.json` was last updated on May 24, 2026.
- `supabase.json.enc`, `stored-accounts.json.enc`, and `cache-v6.json.enc` were updated on June 17, 2026.
- Importing credentials from either stale plaintext source still produces `Authentication required` on `meeting list`.
- The Granola app includes a bundled companion CLI that says the app should own auth and expose notes over a local socket, but the server side reported `APP_NOT_RUNNING` even while Granola was running. The app bundle appears to include a `companion_cli` feature flag defaulting false.

## Progress

- [ ] P1 - Repair plaintext auth import and refresh behavior.
- [ ] P2 - Add encrypted-only/stale-plaintext diagnostics.
- [ ] P3 - Research and choose the durable encrypted-state or companion-CLI path.
- [ ] P4 - Implement the chosen durable path behind explicit safety boundaries.
- [ ] P5 - Update docs, troubleshooting, and release notes.

## Resume Instructions

Read this document fully, then start at the first unchecked `Progress` item. Do not skip P2 diagnostics even if P1 fixes a subset of machines. Treat decrypted desktop state and refresh tokens as sensitive material; do not print them during debugging. Ask the user only if a choice changes the intended product boundary, such as whether to ship encrypted-state decryption in this package or rely on Granola's bundled companion CLI instead.

## Product Intent Alignment

Users and agents should not have to know which Granola desktop storage generation they are on. The normal path should either:

- import usable credentials and verify they work, or
- explain that the desktop app is in encrypted-only mode and name the unsupported path.

The CLI should not repeatedly recommend `granola auth login` when it already knows the plaintext source is stale relative to encrypted state.

## Locked Decisions

- `auth login` must prefer the freshest supported credential source over legacy `supabase.json`.
- `auth login` success must not imply API usability unless credentials can pass a lightweight validation or the CLI clearly labels the action as import-only.
- Errors must distinguish "not signed in", "stale plaintext credentials", "server rejected refresh", and "encrypted-only desktop state unsupported".
- Any encrypted-state implementation must avoid logging or persisting decrypted payloads, DEKs, access tokens, or refresh tokens outside the existing keychain storage boundary.

## Acceptance Criteria

AC1. On installs with current `stored-accounts.json`, `granola auth login` imports from `stored-accounts.json` before falling back to `supabase.json`.

AC2. On installs where `supabase.json` is stale but `.enc` files are newer, the CLI does not present `Credentials imported successfully` as a complete fix unless a real API validation succeeds.

AC3. On 401 refresh, the CLI uses Granola's current refresh flow or emits an accurate refresh-failed diagnostic. It should not silently keep retrying the old WorkOS path if that path is known-invalid.

AC4. On encrypted-only installs, the CLI reports that encrypted desktop state is present and unsupported, including the relevant file names but no secret contents.

AC5. Tests cover legacy plaintext, stored-accounts plaintext, stale plaintext plus newer encrypted files, and refresh failure diagnostics.

AC6. Documentation tells agents and users that `auth status` is presence-only unless validation is added.

## BDD Scenarios

### S1 - Current stored-accounts plaintext

Given `stored-accounts.json` contains fresh tokens and `supabase.json` is stale,
When the user runs `granola auth login`,
Then the CLI imports from `stored-accounts.json`,
And `granola meeting list --limit 1` succeeds.

### S2 - Legacy supabase plaintext

Given only `supabase.json` exists and contains usable legacy tokens,
When the user runs `granola auth login`,
Then the CLI imports from `supabase.json`,
And preserves compatibility with existing legacy installs.

### S3 - Stale plaintext with newer encrypted state

Given `supabase.json` or `stored-accounts.json` exists but is older than `*.json.enc`,
When the user runs `granola auth login`,
Then the CLI warns that plaintext may be stale,
And validation failure reports encrypted-only state instead of recommending the same login loop.

### S4 - Refresh endpoint mismatch

Given the access token is expired but refresh material is otherwise usable,
When an API request returns 401,
Then the client refreshes through the current Granola refresh path or reports that refresh is unsupported,
And it does not mask the failure as "run auth login" when login just imported stale credentials.

### S5 - No safe encrypted-state support

Given only encrypted state is current,
When the CLI lacks a supported decryptor or companion socket,
Then it fails closed with a clear diagnostic,
And no secrets are logged.

## Phase-by-Phase Execution Plan

## P1 - Repair Plaintext Auth Import and Refresh Behavior

### End State

The CLI supports both `stored-accounts.json` and legacy `supabase.json`, preferring `stored-accounts.json`. Refresh no longer relies on a known-broken WorkOS direct call without a targeted diagnostic.

### Tests First

Add or update tests in `tests/lib/auth.test.ts` for:

- parsing `stored-accounts.json` where `accounts` and nested `tokens` are JSON strings,
- parsing defensive object-shaped `accounts` and `tokens`,
- falling back to `supabase.json`,
- preserving legacy WorkOS token parsing.

Add or update tests in `tests/services/client.test.ts` if present, otherwise create a focused service/client test for refresh routing and failure messaging.

### Work

- Add `parseStoredAccountsJson()`.
- Add `getDefaultStoredAccountsPath()`.
- Update `loadCredentialsFromFile()` to try stored accounts first.
- Update login error output to show both supported plaintext candidates.
- Update refresh logic in `src/lib/auth.ts` or `src/services/client.ts` so it uses the correct Granola refresh path if confirmed, or emits a direct diagnostic when WorkOS returns 400.

### Expected Files

- `src/lib/auth.ts`
- `src/commands/auth/login.ts`
- `src/services/client.ts`
- `tests/lib/auth.test.ts`
- `tests/commands/auth/login.test.ts`
- possible `tests/services/client.test.ts`

### Verify

```bash
npm run typecheck
npx vitest run tests/lib/auth.test.ts tests/commands/auth/login.test.ts
npm test
```

## P2 - Add Encrypted-Only and Stale-Plaintext Diagnostics

### End State

The CLI detects when plaintext files are stale relative to encrypted siblings and gives an actionable, secret-safe message.

### Tests First

Add filesystem-mocked tests that cover:

- plaintext missing, encrypted present,
- plaintext older than encrypted sibling,
- plaintext parse succeeds but validation fails,
- no Granola desktop state found.

### Work

- Add a small desktop-state inspection helper that reports file presence and mtimes for:
  - `supabase.json`
  - `stored-accounts.json`
  - `cache-v6.json`
  - `supabase.json.enc`
  - `stored-accounts.json.enc`
  - `cache-v6.json.enc`
  - `storage.dek`
- Use this helper in `auth login` and auth error handling.
- Keep diagnostics to metadata only: path, existence, relative freshness, and next action.

### Expected Files

- `src/lib/auth.ts`
- possible `src/lib/granola-desktop-state.ts`
- `src/commands/auth/login.ts`
- `src/lib/errors.ts`
- `tests/lib/auth.test.ts`
- possible `tests/lib/granola-desktop-state.test.ts`

### Verify

```bash
npx vitest run tests/lib/auth.test.ts
npm run typecheck
npm test
```

## P3 - Research Durable Auth Source

### End State

The repo has enough evidence to choose one durable path: decrypt encrypted state, use Granola's companion CLI/socket, or explicitly leave encrypted-only support out of scope.

### Tests First

No product tests first. This is a research phase. Use small throwaway probes outside committed source, and commit only findings or tests after a product decision exists.

### Work

- Inspect Granola's bundled companion CLI contract:
  - metadata file location: `~/Library/Application Support/Granola/companion-cli/companion-cli.json`
  - socket path hinted by app bundle: temp directory `granola-companion-cli.sock`
  - feature flag: `companion_cli`
- Determine whether the companion server is plan-gated, feature-flagged, or only inactive because of app/runtime state.
- Investigate encrypted-state format without logging secrets:
  - `storage.dek`
  - `Granola Safe Storage` keychain item
  - `*.json.enc` envelope shape
  - whether Electron `safeStorage` is required or if a Node/native helper can safely decrypt.
- Compare plan gating:
  - official API access is Business+,
  - official MCP exists on Basic but transcript/folder tools are paid-plan gated,
  - local encrypted desktop state may still be readable only if the user is signed into desktop.

### Expected Files

- This plan may be updated with research results.
- If keeping research in-repo, add a short `docs/AUTH-RESEARCH.md`; do not commit secret-bearing fixtures.

### Verify

```bash
npm run typecheck
```

## P4 - Implement Chosen Durable Path

### End State

The CLI has a maintained path for current Granola desktop installs, or it explicitly declines encrypted-only support with high-quality diagnostics.

### Tests First

Add tests appropriate to the selected path:

- If decrypting encrypted state, use synthetic encrypted fixtures only.
- If using companion CLI/socket, use mocked metadata/socket responses.
- If declining support, test the fail-closed diagnostic.

### Work

One of:

- Implement encrypted-state decryptor behind explicit helper boundaries, or
- Implement companion socket client and delegate auth to the running app, or
- Keep this package plaintext-only and document the boundary.

### Expected Files

Depends on the selected path, but likely:

- `src/lib/auth.ts`
- `src/services/client.ts`
- possible `src/services/companion.ts`
- possible `src/lib/encrypted-state.ts`
- tests for the selected helper.

### Verify

```bash
npm run typecheck
npm test
npm run check
```

## P5 - Documentation and Release Notes

### End State

Users and agents understand what `auth login`, `auth status`, and API validation actually mean on modern Granola desktop installs.

### Tests First

No tests first unless CLI help snapshots exist.

### Work

- Update `README.md` auth troubleshooting.
- Update `docs/SECURITY.md` if encrypted-state handling is implemented.
- Add release notes explaining:
  - stored-accounts support,
  - stale plaintext detection,
  - refresh behavior,
  - encrypted-only limitations or support.

### Expected Files

- `README.md`
- `docs/SECURITY.md`
- possible `docs/INTERNALS.md`

### Verify

```bash
npm run check
npm run typecheck
```

## Verification Strategy

Use unit tests for parsing, source selection, diagnostics, and refresh routing. Use one local manual smoke test only after tests pass:

```bash
npm run build
node dist/main.js auth login
node dist/main.js meeting list --limit 1 --output json --no-pager
```

Do not paste command output containing tokens. If debug logs are needed, redact bearer tokens, access tokens, refresh tokens, DEKs, session ids, and decrypted JSON payloads.

## Delivery Order

1. P1 and P2 together are the first useful PR.
2. P3 should produce a short decision note before P4 starts.
3. P4 should be its own PR because encrypted-state or companion-socket support changes the trust boundary.
4. P5 can ship with the first PR for diagnostics, then be expanded after P4.

## Non-Goals

- Bypassing Granola plan gating for official API, MCP, transcript, or folder access.
- Logging, exporting, or committing real Granola tokens or decrypted desktop state.
- Replacing the official Granola MCP integration.
- Building a broad desktop automation bridge inside this CLI.

## Decisions / Deviations Log

- 2026-06-17: Initial plan created from local debugging and upstream issue/PR research. Current local evidence shows both plaintext auth files are stale while encrypted files are current, so PR #6 alone is insufficient for Granola desktop 7.324.2 on this machine.
