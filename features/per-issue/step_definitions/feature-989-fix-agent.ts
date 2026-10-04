/**
 * The static-check fix agent the feature-989 phase scenarios script. Only the agent run is replaced:
 * the real fix-round port still publishes each round's base, commits what the round changed, takes its
 * diff, lets the real guard judge it, and pushes or resets for real.
 *
 * On its n-th start the script records what it was handed and how many throwaway-CLI runs had started,
 * applies round n's change to the worktree, and switches what the checks with a column for that round
 * print from then on. The switch lives outside the worktree: a check whose output changes is rewritten,
 * before the setup commit, to print files in a temporary directory that the script rewrites, so the
 * switch is never part of a round's diff. A check without a column keeps its output.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { Before, type DataTable } from '@cucumber/cucumber';

import type { runResolveTestAgent, TestResult } from '../../../adws/agents/testAgent.ts';
import { StaticCheckName } from '../../../adws/core/checkRunner.ts';
import { buildStaticCheckFixRoundPort } from '../../../adws/phases/staticCheckFixRound.ts';

import { readRuns } from './feature-929-compacting-cli.ts';
import type { Workflow929 } from './feature-929-workflow.ts';
import { COMMANDS_FILE, parseOutcome, type CheckOutcome } from './feature-988-commands.ts';
import { s } from './feature-988-world.ts';
import { commitSetup, prepareBranchAndOrigin } from './feature-989-git.ts';

interface RoundChange {
  readonly file: string;
  readonly line: string;
}

interface ScriptedRound {
  readonly change: RoundChange | null;
  /** What each check with a column for this round prints, and exits with, once the round has run. */
  readonly outcomes: ReadonlyMap<StaticCheckName, CheckOutcome>;
}

interface CheckSwitch {
  readonly outFile: string;
  readonly codeFile: string;
}

export interface RecordedStart {
  /** What the round's agent run was handed. */
  readonly input: TestResult;
  /** The slash command of every throwaway-CLI run that had started by then. */
  readonly cliRuns: readonly string[];
}

interface Script {
  /** Null when every round changes nothing. */
  rounds: readonly ScriptedRound[] | null;
  starts: RecordedStart[];
  switches: Map<StaticCheckName, CheckSwitch>;
}

const script: Script = { rounds: null, starts: [], switches: new Map() };

Before({ tags: '@adw-989' }, function () {
  Object.assign(script, { rounds: null, starts: [], switches: new Map() });
});

const ADDS_A_LINE = /^adds "(.*)" to "(.*)"$/;
const AFTERWARDS = / afterwards$/;
const NOT_APPLICABLE = 'N/A';
const UNCHANGED_ROUND: ScriptedRound = { change: null, outcomes: new Map() };

function checkNamed(name: string): StaticCheckName {
  const check = Object.values(StaticCheckName).find(candidate => candidate === name);
  return check ?? assert.fail(`Unknown static check "${name}"`);
}

function parseChange(wording: string): RoundChange {
  const match = ADDS_A_LINE.exec(wording);
  assert.ok(match, `Unrecognised wording for what a fix round changes: ${wording}`);
  return { line: match[1], file: match[2] };
}

function outcomesOf(row: Readonly<Record<string, string>>): Map<StaticCheckName, CheckOutcome> {
  const columns = Object.entries(row).filter(([column]) => AFTERWARDS.test(column));
  return new Map(columns.map(([column, wording]) => [checkNamed(column.replace(AFTERWARDS, '')), parseOutcome(wording)]));
}

function parseRounds(table: DataTable): ScriptedRound[] {
  return table.hashes().map((row, index) => {
    assert.strictEqual(Number(row.round), index + 1, `Rounds are listed in order: expected round ${index + 1}, got round ${row.round}`);
    return { change: parseChange(row.changes), outcomes: outcomesOf(row) };
  });
}

function writeOutcome(checkSwitch: CheckSwitch, outcome: CheckOutcome): void {
  assert.ok(!outcome.toStandardError, 'A check whose output changes from round to round prints to standard output');
  fs.writeFileSync(checkSwitch.outFile, `${outcome.text}\n`);
  fs.writeFileSync(checkSwitch.codeFile, String(outcome.exitCode));
}

function replaceInCommandsFile(worktreePath: string, from: string, to: string): void {
  const file = path.join(worktreePath, COMMANDS_FILE);
  const content = fs.readFileSync(file, 'utf-8');
  assert.ok(content.includes(from), `Expected ${COMMANDS_FILE} to hold the command ${from}`);
  fs.writeFileSync(file, content.replace(from, () => to), 'utf-8');
}

function installSwitch(worktreePath: string, directory: string, check: StaticCheckName): void {
  const configured = s.configured.find(entry => entry.check === check);
  assert.ok(configured && configured.command !== NOT_APPLICABLE, `The scenario scripts what "${check}" prints afterwards, but configures no command for it`);

  const slug = check.replace(/\s+/g, '-');
  const checkSwitch = { outFile: path.join(directory, `${slug}.out`), codeFile: path.join(directory, `${slug}.code`) };
  writeOutcome(checkSwitch, parseOutcome(configured.described));

  const command = `cat '${checkSwitch.outFile}'; exit "$(cat '${checkSwitch.codeFile}')"`;
  replaceInCommandsFile(worktreePath, configured.command, command);
  s.configured = s.configured.map(entry => (entry === configured ? { ...entry, command } : entry));
  script.switches.set(check, checkSwitch);
}

function startedCommands(): string[] {
  return s.cli ? readRuns(s.cli.runLogPath).map(run => run.command) : [];
}

function roundOfStart(start: number): ScriptedRound {
  if (script.rounds === null) return UNCHANGED_ROUND;
  return script.rounds[start - 1] ?? assert.fail(`The scenario scripts ${script.rounds.length} fix round(s), but the static-check fix agent was started ${start} times`);
}

function applyChange(worktreePath: string, { file, line }: RoundChange): void {
  const target = path.join(worktreePath, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${line}\n`);
}

const fixAgent: typeof runResolveTestAgent = async (failedTest, _logsDir, _statePath, worktreePath) => {
  assert.ok(worktreePath, 'Expected the static-check fix agent to be started in the workflow\'s worktree');
  script.starts.push({ input: failedTest, cliRuns: startedCommands() });

  const round = roundOfStart(script.starts.length);
  if (round.change) applyChange(worktreePath, round.change);
  round.outcomes.forEach((outcome, check) => {
    const checkSwitch = script.switches.get(check) ?? assert.fail(`No switch is installed for "${check}"`);
    writeOutcome(checkSwitch, outcome);
  });
  return { success: true, output: '', totalCostUsd: 0.01, modelUsage: {} };
};

/** The rounds, or `null` for a fix agent whose every round changes nothing; the phase then runs the real port around the script. */
export function scriptFixAgent(workflow: Workflow929, table: DataTable | null): void {
  script.rounds = table ? parseRounds(table) : null;

  const switched = new Set(script.rounds?.flatMap(round => [...round.outcomes.keys()]));
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'adw-989-checks-'));
  s.directories.push(directory);
  switched.forEach(check => installSwitch(workflow.worktreePath, directory, check));

  s.fixRounds = buildStaticCheckFixRoundPort(workflow.config, { runResolveTestAgent: fixAgent });
  s.beforePhase = () => {
    prepareBranchAndOrigin(workflow);
    commitSetup(workflow.worktreePath);
  };
}

export function fixAgentStarts(): readonly RecordedStart[] {
  return script.starts;
}

/** The output the round's agent run was handed for one failing check, as the port words it: a section headed by the check's name. */
export function outputHandedFor(input: TestResult, check: string): string {
  const headings = Object.values(StaticCheckName).map(name => `## ${name}`);
  const lines = (input.error ?? '').split('\n');
  const start = lines.indexOf(`## ${check}`);
  assert.ok(start >= 0, `Expected the fix agent to be handed the failing check "${check}", got:\n${input.error}`);

  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => headings.includes(line));
  const section = end < 0 ? rest : rest.slice(0, end);
  const outputAt = section.indexOf('Output:');
  assert.ok(outputAt >= 0, `Expected the section of "${check}" to hold its output, got:\n${section.join('\n')}`);
  return section.slice(outputAt + 1).join('\n').trim();
}
