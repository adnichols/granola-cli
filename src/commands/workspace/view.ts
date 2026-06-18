import chalk from 'chalk';
import { Command } from 'commander';
import { createGranolaDebug } from '../../lib/debug.js';
import { AuthRecoveryError, handleGlobalError } from '../../lib/errors.js';
import { formatDate, formatOutput, type OutputFormat } from '../../lib/output.js';
import * as workspaces from '../../services/workspaces.js';

const debug = createGranolaDebug('cmd:workspace:view');

/**
 * Creates the 'view' command for displaying workspace details.
 *
 * Shows workspace metadata including name and creation date.
 * Supports -o/--output for structured output.
 *
 * @returns Commander command instance
 */
export function createViewCommand() {
  return new Command('view')
    .description('View workspace details')
    .argument('<id>', 'Workspace ID')
    .option('-o, --output <format>', 'Output format (json, yaml, toon)')
    .action(async (id: string, opts) => {
      debug('workspace view command invoked with id: %s', id);

      let fullId: string;
      try {
        const resolved = await workspaces.resolveId(id);
        if (!resolved) {
          console.error(chalk.red(`Workspace ${id} not found`));
          process.exit(4);
        }
        fullId = resolved;
      } catch (err) {
        if (err instanceof AuthRecoveryError) process.exit(handleGlobalError(err));
        console.error(chalk.red((err as Error).message));
        process.exit(1);
      }

      const workspace = await workspaces.get(fullId);

      if (!workspace) {
        console.error(chalk.red(`Workspace ${id} not found`));
        process.exit(4);
      }

      // Handle structured output formats
      const format = opts.output || null;
      if (format) {
        if (!['json', 'yaml', 'toon'].includes(format)) {
          console.error(chalk.red(`Invalid format: ${format}. Use 'json', 'yaml', or 'toon'.`));
          process.exit(1);
        }
        console.log(formatOutput(workspace, format as OutputFormat));
        return;
      }

      console.log(chalk.bold(workspace.name));
      console.log(chalk.dim(`Created ${formatDate(workspace.created_at)}`));
      console.log();
      console.log(`View all meetings:  granola meeting list --workspace ${id}`);
    });
}

export const viewCommand = createViewCommand();
