/**
 * Turns the scenarios' plain-words tables of static checks into a real ".adw/commands.md".
 *
 * A scenario says "prints "0 problems" and exits 1"; the file gets one unfenced shell line
 * that does exactly that, so the real shell decides the exit code and what is written to
 * standard output and standard error. A wording this module does not know fails the step
 * instead of being guessed at.
 */

import assert from 'assert';
import { StaticCheckName } from '../../../adws/core/checkRunner.ts';

export const COMMANDS_FILE = '.adw/commands.md';

export interface ConfiguredCheck {
  readonly check: StaticCheckName;
  /** The shell line written under the check's heading, or `N/A`. */
  readonly command: string;
}

const HEADINGS: Readonly<Record<StaticCheckName, string>> = {
  [StaticCheckName.TypeCheck]: 'Type Check',
  [StaticCheckName.AdditionalTypeChecks]: 'Additional Type Checks',
  [StaticCheckName.Lint]: 'Run Linter',
  [StaticCheckName.Build]: 'Run Build',
};

const NOT_APPLICABLE = 'N/A';
const PRINTS_AND_EXITS = /^prints "(.*)"( to standard error)? and exits (\d+)$/;

function isStaticCheckName(value: string): value is StaticCheckName {
  return (Object.values(StaticCheckName) as string[]).includes(value);
}

function singleQuoted(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function toShellLine(described: string): string {
  if (described === NOT_APPLICABLE) return NOT_APPLICABLE;
  const match = PRINTS_AND_EXITS.exec(described);
  assert.ok(match, `Unrecognised wording for a static check's command: ${described}`);
  const [, text, toStandardError, exitCode] = match;
  return `printf '%s\\n' ${singleQuoted(text)}${toStandardError ? ' >&2' : ''}; exit ${exitCode}`;
}

function toConfiguredCheck(row: { readonly check: string; readonly command: string }): ConfiguredCheck {
  assert.ok(isStaticCheckName(row.check), `Unknown static check "${row.check}"`);
  return { check: row.check, command: toShellLine(row.command) };
}

/** Commands are how a run is told apart from another, so two checks may not share one. */
function assertRunnableCommandsAreDistinct(configured: readonly ConfiguredCheck[]): void {
  const runnable = configured.map(entry => entry.command).filter(command => command !== NOT_APPLICABLE);
  assert.strictEqual(new Set(runnable).size, runnable.length, 'Two static checks of one scenario must not share a command');
}

export function configuredChecksFrom(rows: readonly { readonly check: string; readonly command: string }[]): ConfiguredCheck[] {
  const configured = rows.map(toConfiguredCheck);
  assertRunnableCommandsAreDistinct(configured);
  return configured;
}

/** One section per row, in the table's order, so a scenario can list the checks in any order it likes. */
export function renderCommandsMd(configured: readonly ConfiguredCheck[]): string {
  const sections = configured.map(entry => `## ${HEADINGS[entry.check]}\n\n${entry.command}`);
  return `# Commands\n\n${sections.join('\n\n')}\n`;
}

/** The checks whose command a run was handed, named in run order. */
export function checksThatRan(configured: readonly ConfiguredCheck[], ranCommands: readonly string[]): StaticCheckName[] {
  return ranCommands.map(command => {
    const entry = configured.find(candidate => candidate.command === command);
    assert.ok(entry, `A command ran that no static check configures: ${command}`);
    return entry.check;
  });
}
