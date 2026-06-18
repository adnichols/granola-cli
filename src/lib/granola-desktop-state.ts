import { stat } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export const GRANOLA_DESKTOP_STATE_FILES = [
  'supabase.json',
  'stored-accounts.json',
  'cache-v6.json',
  'supabase.json.enc',
  'stored-accounts.json.enc',
  'cache-v6.json.enc',
  'storage.dek',
] as const;

export type GranolaDesktopStateFile = (typeof GRANOLA_DESKTOP_STATE_FILES)[number];

export interface GranolaDesktopStateEntry {
  name: GranolaDesktopStateFile;
  path: string;
  exists: boolean;
  mtimeMs?: number;
}

export interface GranolaDesktopState {
  directory: string;
  files: GranolaDesktopStateEntry[];
}

const SUPPORTED_PLAINTEXT_CREDENTIAL_FILES = new Set<GranolaDesktopStateFile>([
  'supabase.json',
  'stored-accounts.json',
]);

const ENCRYPTED_FILES = new Set<GranolaDesktopStateFile>([
  'supabase.json.enc',
  'stored-accounts.json.enc',
  'cache-v6.json.enc',
  'storage.dek',
]);

export function getDefaultGranolaStateDirectory(): string {
  const home = homedir();
  const os = platform();

  switch (os) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Granola');
    case 'win32':
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Granola');
    default:
      return join(home, '.config', 'granola');
  }
}

export async function inspectGranolaDesktopState(
  directory = getDefaultGranolaStateDirectory(),
): Promise<GranolaDesktopState> {
  const files = await Promise.all(
    GRANOLA_DESKTOP_STATE_FILES.map(async (name) => {
      const path = join(directory, name);
      try {
        const info = await stat(path);
        return {
          name,
          path,
          exists: true,
          mtimeMs: info.mtimeMs,
        } satisfies GranolaDesktopStateEntry;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          return { name, path, exists: false } satisfies GranolaDesktopStateEntry;
        }
        throw error;
      }
    }),
  );

  return { directory, files };
}

export function getExistingFileNames(state: GranolaDesktopState): GranolaDesktopStateFile[] {
  return state.files.filter((file) => file.exists).map((file) => file.name);
}

export function hasAnyDesktopState(state: GranolaDesktopState): boolean {
  return state.files.some((file) => file.exists);
}

export function hasEncryptedState(state: GranolaDesktopState): boolean {
  return state.files.some((file) => file.exists && ENCRYPTED_FILES.has(file.name));
}

export function hasSupportedPlaintextState(state: GranolaDesktopState): boolean {
  return state.files.some(
    (file) => file.exists && SUPPORTED_PLAINTEXT_CREDENTIAL_FILES.has(file.name),
  );
}

export function isPlaintextStaleRelativeToEncrypted(
  state: GranolaDesktopState,
  plaintextName: GranolaDesktopStateFile,
): boolean {
  const plaintext = state.files.find((file) => file.name === plaintextName);
  if (!plaintext?.exists || plaintext.mtimeMs === undefined) return false;
  const plaintextMtimeMs = plaintext.mtimeMs;

  return state.files.some(
    (file) =>
      file.exists &&
      ENCRYPTED_FILES.has(file.name) &&
      file.mtimeMs !== undefined &&
      file.mtimeMs > plaintextMtimeMs,
  );
}

export function describeDesktopState(state: GranolaDesktopState): string {
  const names = getExistingFileNames(state);
  if (names.length === 0) return 'No Granola desktop auth state files were found.';
  return `Found Granola desktop auth state files: ${names.join(', ')}.`;
}
