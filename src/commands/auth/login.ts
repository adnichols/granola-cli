import chalk from 'chalk';
import { Command } from 'commander';
import {
  getAuthImportFailureMessage,
  getDefaultStoredAccountsPath,
  getDefaultSupabasePath,
  loadCredentialsFromFile,
  saveCredentials,
} from '../../lib/auth.js';
import { createGranolaDebug } from '../../lib/debug.js';

const debug = createGranolaDebug('cmd:auth:login');

/**
 * Creates the 'login' command for authenticating with Granola.
 * Imports credentials from the Granola desktop app.
 *
 * @example
 * granola auth login
 *
 * @returns Commander command instance
 */
export function createLoginCommand() {
  return new Command('login')
    .description('Import credentials from Granola desktop app')
    .action(async () => {
      debug('login command invoked');
      const result = await loadCredentialsFromFile();
      if (!result) {
        debug('login failed: could not load supported plaintext credentials');
        console.error(chalk.red('Error:'), 'Could not load supported plaintext credentials.');
        console.error(`Checked: ${chalk.dim(getDefaultStoredAccountsPath())}`);
        console.error(`Checked: ${chalk.dim(getDefaultSupabasePath())}`);
        console.error(await getAuthImportFailureMessage());
        process.exit(1);
      }

      debug('credentials loaded from %s, saving to keychain', result.sourcePath);
      await saveCredentials(result.credentials);

      if (result.warnings.length > 0) {
        debug('login import completed with warnings');
        console.log(chalk.yellow('Credentials imported, but may be stale'));
        console.log(`Source: ${chalk.dim(result.sourcePath)}`);
        for (const warning of result.warnings) {
          console.log(chalk.yellow('Warning:'), warning);
        }
        console.log(
          chalk.dim(
            'Run an API command such as granola meeting list --limit 1 to validate these credentials.',
          ),
        );
        return;
      }

      debug('login successful');
      console.log(chalk.green('Credentials imported successfully'));
      console.log(`Source: ${chalk.dim(result.sourcePath)}`);
    });
}

export const loginCommand = createLoginCommand();
