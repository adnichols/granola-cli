import chalk from 'chalk';
import { Command } from 'commander';
import open from 'open';
import { createGranolaDebug } from '../../lib/debug.js';
import { AuthRecoveryError, handleGlobalError } from '../../lib/errors.js';
import { formatDate, formatOutput, type OutputFormat } from '../../lib/output.js';
import * as meetings from '../../services/meetings.js';

const debug = createGranolaDebug('cmd:meeting:view');

/**
 * Creates the 'view' command for displaying meeting details.
 *
 * Shows meeting metadata including title, date, and workspace.
 * Supports --web to open in browser and --format for structured output.
 *
 * @returns Commander command instance
 */
export function createViewCommand() {
  return new Command('view')
    .description('View meeting details')
    .argument('<id>', 'Meeting ID')
    .option('--web', 'Open in browser')
    .option('-o, --output <format>', 'Output format (json, yaml, toon)')
    .action(async (id: string, opts) => {
      debug('view command invoked with id: %s, opts: %O', id, opts);

      let fullId: string;
      try {
        const resolved = await meetings.resolveId(id);
        if (!resolved) {
          console.error(chalk.red(`Meeting ${id} not found`));
          process.exit(4);
        }
        fullId = resolved;
      } catch (err) {
        if (err instanceof AuthRecoveryError) process.exit(handleGlobalError(err));
        console.error(chalk.red((err as Error).message));
        process.exit(1);
      }

      if (opts.web) {
        await open(`https://notes.granola.ai/d/${fullId}`);
        return;
      }

      const meeting = await meetings.get(fullId);

      if (!meeting) {
        console.error(chalk.red(`Meeting ${id} not found`));
        process.exit(4);
      }

      // Handle structured output formats
      const format = opts.output || null;
      if (format) {
        if (!['json', 'yaml', 'toon'].includes(format)) {
          console.error(chalk.red(`Invalid format: ${format}. Use 'json', 'yaml', or 'toon'.`));
          process.exit(1);
        }
        console.log(formatOutput(meeting, format as OutputFormat));
        return;
      }

      // Human-readable output
      console.log(chalk.bold(meeting.title));
      console.log(chalk.dim(`Recorded ${formatDate(meeting.created_at)}`));
      console.log();
      console.log(`Workspace:    ${meeting.workspace_id || 'Personal'}`);

      // Display participants
      if (meeting.creator?.name) {
        console.log(`Organizer:    ${meeting.creator.name}`);
      }

      if (meeting.attendees?.length) {
        console.log(`Attendees:    ${meeting.attendees.length} participant(s)`);
        for (const attendee of meeting.attendees) {
          const name = attendee.name || attendee.details?.person?.name?.fullName || 'Unknown';
          const title = attendee.details?.employment?.title;
          const info = title ? `${name} (${title})` : name;
          console.log(chalk.dim(`              - ${info}`));
        }
      }

      console.log();
      console.log(`${chalk.dim('View notes:       ')}granola meeting notes ${id}`);
      console.log(`${chalk.dim('View transcript:  ')}granola meeting transcript ${id}`);
    });
}

export const viewCommand = createViewCommand();
