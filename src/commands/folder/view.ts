import chalk from 'chalk';
import { Command } from 'commander';
import { createGranolaDebug } from '../../lib/debug.js';
import { AuthRecoveryError, handleGlobalError } from '../../lib/errors.js';
import { formatOutput, type OutputFormat } from '../../lib/output.js';
import { get as getFolder } from '../../services/folders.js';
import type { Folder } from '../../types.js';

const debug = createGranolaDebug('cmd:folder:view');

/**
 * Creates the 'view' command for displaying folder details.
 *
 * Shows folder metadata including name, meeting count, and workspace.
 * Supports -o/--output for structured output.
 *
 * @returns Commander command instance
 */
export function createViewCommand() {
  return new Command('view')
    .description('View folder details')
    .argument('<id>', 'Folder ID')
    .option('-o, --output <format>', 'Output format (json, yaml, toon)')
    .action(async (id: string, opts) => {
      debug('folder view command invoked with id: %s', id);

      let folder: Folder | null;
      try {
        folder = await getFolder(id);
      } catch (error) {
        if (error instanceof AuthRecoveryError) process.exit(handleGlobalError(error));
        console.error(chalk.red('Error:'), 'Failed to load folder.');
        if (error instanceof Error) {
          console.error(chalk.dim(error.message));
        }
        process.exit(1);
      }

      if (!folder) {
        console.error(chalk.red(`Folder ${id} not found`));
        process.exit(4);
      }

      // Handle structured output formats
      const format = opts.output || null;
      if (format) {
        if (!['json', 'yaml', 'toon'].includes(format)) {
          console.error(chalk.red(`Invalid format: ${format}. Use 'json', 'yaml', or 'toon'.`));
          process.exit(1);
        }
        console.log(formatOutput(folder, format as OutputFormat));
        return;
      }

      const name = folder.name || folder.title || 'Unnamed';
      const docCount = folder.document_ids?.length || 0;

      console.log(chalk.bold(name));
      console.log(chalk.dim(`${docCount} meetings · Workspace ${folder.workspace_id}`));
      console.log();
      console.log(chalk.dim('Tip: Use "granola meeting list" to browse recent meetings.'));
    });
}

export const viewCommand = createViewCommand();
