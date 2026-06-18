import chalk from 'chalk';
import { Command } from 'commander';
import { createGranolaDebug } from '../../lib/debug.js';
import { AuthRecoveryError, handleGlobalError } from '../../lib/errors.js';
import { formatOutput, type OutputFormat } from '../../lib/output.js';
import { pipeToPager } from '../../lib/pager.js';
import { formatTranscript } from '../../lib/transcript.js';
import * as meetings from '../../services/meetings.js';

const debug = createGranolaDebug('cmd:meeting:transcript');
const SOURCE_OPTIONS = new Set(['microphone', 'system', 'all']);

/**
 * Creates the 'transcript' command for displaying meeting transcripts.
 *
 * Retrieves and formats meeting transcripts with optional timestamps.
 * Supports filtering by audio source (microphone, system, or all).
 * Uses a pager for long output in interactive terminals.
 *
 * @returns Commander command instance
 */
export function createTranscriptCommand() {
  return new Command('transcript')
    .description('View meeting transcript')
    .argument('<id>', 'Meeting ID')
    .option('-t, --timestamps', 'Include timestamps')
    .option('-s, --source <type>', 'Filter: microphone, system, all', 'all')
    .option('-o, --output <format>', 'Output format (text, json, yaml, toon)', 'text')
    .action(async (id: string, opts, cmd) => {
      debug('transcript command invoked with id: %s, opts: %O', id, opts);
      const global = cmd.optsWithGlobals();

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

      const transcript = await meetings.getTranscript(fullId);

      if (transcript.length === 0) {
        console.error(chalk.red(`No transcript found for meeting ${id}`));
        process.exit(4);
      }

      const requestedSource = opts.source || 'all';
      if (!SOURCE_OPTIONS.has(requestedSource)) {
        console.error(
          chalk.red(`Invalid source: ${requestedSource}. Use 'microphone', 'system', or 'all'.`),
        );
        process.exit(1);
      }

      const format = opts.output || 'text';
      const structuredFormats: OutputFormat[] = ['json', 'yaml', 'toon'];
      if (format !== 'text' && !structuredFormats.includes(format as OutputFormat)) {
        console.error(
          chalk.red(`Invalid format: ${format}. Use 'text', 'json', 'yaml', or 'toon'.`),
        );
        process.exit(1);
      }

      if (structuredFormats.includes(format as OutputFormat)) {
        console.log(formatOutput(transcript, format as OutputFormat));
        return;
      }

      const output = formatTranscript(transcript, {
        timestamps: opts.timestamps,
        source: requestedSource as 'microphone' | 'system' | 'all',
      });

      if (global.noPager || !process.stdout.isTTY) {
        console.log(output);
      } else {
        await pipeToPager(output);
      }
    });
}

export const transcriptCommand = createTranscriptCommand();
