/**
 * The throwaway Claude CLI the feature-1104 scenarios spawn in place of the real one. For each run it records what the run was
 * started with: its working directory, its prompt, the slash command the prompt opens with, and the text of that command as
 * `<cwd>/.claude/commands/<name>.md` holds it. It then hands the run, with its arguments, to the generic stub, so the scenario's
 * manifest still answers and the phase gets the stub's stream.
 *
 * `getSafeSubprocessEnv()` filters the spawned CLI's environment, so nothing reaches the script through `MOCK_*` variables: every
 * absolute path is baked into the script when it is written. The records live outside the worktree, so they never change its tree
 * and are never committed. No hooks and no steps: any step file may import it.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { VALUE_FLAGS } from '../../../test/mocks/stubArgs.ts';
import { CLAUDE_CLI_STUB } from '../../regression/support/claudeCliStub.ts';

export interface InstalledStandIn {
  readonly dir: string;
  readonly scriptPath: string;
  readonly runsDir: string;
}

export interface StandInRun {
  /** 1-based position among the runs the stand-in served, in start order. */
  readonly run: number;
  readonly cwd: string;
  readonly prompt: string;
  /** The slash command the prompt opens with; empty when it opens with none. */
  readonly command: string;
  /** The command file as `<cwd>/.claude/commands/<name>.md` held it when the run started; absent when the worktree had none. */
  readonly commandText: string | undefined;
}

const FLAG = /^--[a-z-]+$/;

/** A scenario starts a handful of agents; a record directory that cannot be made would otherwise make the script count forever. */
const MAX_RUNS = 1000;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The prompt is read as `test/mocks/stubArgs.ts` reads it: the first argument that is neither a flag nor the value of one. */
function scriptText({ runsDir }: Pick<InstalledStandIn, 'runsDir'>): string {
  const valueFlags = [...VALUE_FLAGS];
  for (const flag of valueFlags) assert.match(flag, FLAG, `"${flag}" cannot be a flag pattern of the stand-in`);
  return [
    '#!/bin/sh',
    `RUNS_DIR=${shellQuote(runsDir)}`,
    `GENERIC_STUB=${shellQuote(CLAUDE_CLI_STUB)}`,
    'set -fu',
    '',
    'prompt=',
    'skip=no',
    'for argument do',
    '  if [ "$skip" = yes ]; then skip=no; continue; fi',
    '  case "$argument" in',
    `    ${valueFlags.join('|')}) skip=yes ;;`,
    '    -*) ;;',
    '    *) prompt=$argument; break ;;',
    '  esac',
    'done',
    '',
    'run=1',
    'while ! mkdir "$RUNS_DIR/$run" 2> /dev/null; do',
    '  run=$((run + 1))',
    `  if [ "$run" -gt ${MAX_RUNS} ]; then echo "The stand-in Claude CLI cannot record its run in $RUNS_DIR" >&2; exit 1; fi`,
    'done',
    'record="$RUNS_DIR/$run"',
    "printf '%s' \"$(pwd -P)\" > \"$record/cwd\"",
    "printf '%s' \"$prompt\" > \"$record/prompt\"",
    '',
    'command=',
    'case "$prompt" in',
    '  /*) command=${prompt%%[[:space:]]*} ;;',
    'esac',
    "printf '%s' \"$command\" > \"$record/command\"",
    'name=${command#/}',
    'case "$name" in',
    "  ''|*/*) ;;",
    '  *) if [ -f ".claude/commands/$name.md" ]; then cp ".claude/commands/$name.md" "$record/command.md"; fi ;;',
    'esac',
    '',
    'exec "$GENERIC_STUB" "$@"',
    '',
  ].join('\n');
}

/** Writes the script and the directory of its records; the caller owns removing the directory and pointing CLAUDE_CODE_PATH at the script. */
export function writeStandInCli(): InstalledStandIn {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'adw-1104-cli-'));
  const installed: InstalledStandIn = { dir, scriptPath: path.join(dir, 'claude-stand-in.sh'), runsDir: path.join(dir, 'runs') };
  fs.mkdirSync(installed.runsDir);
  fs.writeFileSync(installed.scriptPath, scriptText(installed), { mode: 0o755 });
  return installed;
}

function readRun(runsDir: string, run: number): StandInRun {
  const record = path.join(runsDir, String(run));
  const read = (name: string): string => fs.readFileSync(path.join(record, name), 'utf-8');
  const commandFile = path.join(record, 'command.md');
  return {
    run,
    cwd: read('cwd'),
    prompt: read('prompt'),
    command: read('command'),
    commandText: fs.existsSync(commandFile) ? fs.readFileSync(commandFile, 'utf-8') : undefined,
  };
}

/** Every run the stand-in served, in start order. */
export function readRuns({ runsDir }: Pick<InstalledStandIn, 'runsDir'>): StandInRun[] {
  return fs
    .readdirSync(runsDir)
    .map(Number)
    .sort((first, second) => first - second)
    .map((run) => readRun(runsDir, run));
}
