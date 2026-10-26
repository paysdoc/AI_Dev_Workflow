/**
 * The throwaway Claude CLI the feature-1103 scenarios spawn in place of the real one. The script's body is
 * feature-1103-cli.sh, which says what it plays; this module writes it with the configuration it reads, and reads
 * back the log of the runs it served.
 *
 * `getSafeSubprocessEnv()` filters the spawned CLI's environment, so nothing reaches the script through `MOCK_*`
 * variables: every absolute path and every behaviour is baked into the script when it is written. The run log and
 * the prompts it saves live outside the worktree, so they never change the tree hash and are never committed.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { MAX_THINKING_TOKENS, TOKEN_LIMIT_THRESHOLD } from '../../../adws/core/config.ts';

export type ContextEdits =
  | { kind: 'plan_step'; step: number }
  | { kind: 'next_plan_step' }
  | { kind: 'none' }
  | { kind: 'non_plan_file' };

export type ContextEnd = 'token_limit' | 'compaction' | 'finish';

export interface ContextBehaviour {
  edits: ContextEdits;
  /** The line the context's text ends with, or null when it reports nothing. */
  report: string | null;
  ends: ContextEnd;
}

export interface ContextRule {
  /** First context (1-based) the rule covers. */
  from: number;
  /** Last context the rule covers; null covers every context from `from` on. */
  to: number | null;
  behaviour: ContextBehaviour;
}

export interface StandInSpec {
  worktreePath: string;
  /** Relative path of the file each plan step names, in step order. */
  planStepFiles: readonly string[];
  commitsEverything: boolean;
  rules: readonly ContextRule[];
}

export interface InstalledStandIn {
  dir: string;
  scriptPath: string;
  runLogPath: string;
  promptDir: string;
}

export interface ContextRecord {
  command: string;
  /** 1-based position among the build agent's runs. */
  run: number;
  prompt: string;
  stopped: boolean;
  completed: boolean;
}

export interface RunLog {
  contexts: ContextRecord[];
  /** Runs the stand-in could not play as scripted: none is a run a scenario means to have. */
  problems: string[];
}

export const BUILD_COMMANDS: readonly string[] = ['/implement', '/implement-tdd'];

const IDENTIFYING_PREFIX = 'Context ';
const IDENTIFYING_SUFFIX = ' of the stand-in build agent';

/** The line a context's text carries to say which context wrote it; the continuation prompt quotes the tail of that text. */
export function identifyingLine(run: number): string {
  return `${IDENTIFYING_PREFIX}${run}${IDENTIFYING_SUFFIX}`;
}

export function planStepFile(step: number): string {
  return `src/plan-step-${step}.ts`;
}

/** Longer than the text ADW lets a run stream before it stops it: output tokens are estimated at four characters each. */
function fillerLength(): number {
  return Math.ceil(MAX_THINKING_TOKENS * TOKEN_LIMIT_THRESHOLD * 4) + 1024;
}

/** How long a run waits for ADW to stop it. It stays under the suite's 60-second step timeout, so a run ADW never stopped is reported as abandoned and not as a timeout. */
const ABANDON_AFTER_SECONDS = 40;

const SAFE_LINE = /^[\w .-]*$/;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function assignment(name: string, value: string | number): string {
  return `${name}=${shellQuote(String(value))}`;
}

function branchOf({ from, to, behaviour }: ContextRule, index: number): string {
  const { edits, report, ends } = behaviour;
  assert.ok(report === null || SAFE_LINE.test(report), `"${report}" cannot be written into a JSON string by the stand-in`);
  const upperBound = to === null ? '' : ` && [ "$run" -le ${to} ]`;
  const step = edits.kind === 'plan_step' ? edits.step : 0;
  return [
    `  ${index === 0 ? 'if' : 'elif'} [ "$run" -ge ${from} ]${upperBound}; then`,
    `    ${assignment('EDITS', edits.kind)}; ${assignment('STEP', step)}; ${assignment('REPORT', report ?? '')}; ${assignment('ENDS', ends)}`,
  ].join('\n');
}

/** First rule that covers the run wins; a run no rule covers is one the table forgot, which the script reports. */
function chooseBehaviourFunction(rules: readonly ContextRule[]): string {
  const branches = rules.map(branchOf);
  return ['choose_behaviour() {', ...branches, ...(branches.length > 0 ? ['  else', '    return 1', '  fi'] : ['  return 1']), '}'].join('\n');
}

function configuration(spec: StandInSpec, installed: InstalledStandIn): string {
  for (const file of spec.planStepFiles) assert.match(file, /^[\w./-]+$/, `"${file}" cannot be listed as a plan step file by the stand-in`);
  const settings = [
    assignment('WORKTREE', spec.worktreePath),
    assignment('GIT_BIN', process.env['REAL_GIT_PATH'] ?? 'git'),
    assignment('RUN_LOG', installed.runLogPath),
    assignment('COUNTER_DIR', path.join(installed.dir, 'counters')),
    assignment('PROMPT_DIR', installed.promptDir),
    assignment('FILLER_FILE', path.join(installed.dir, 'filler.txt')),
    assignment('ABANDON_AFTER_SECONDS', ABANDON_AFTER_SECONDS),
    assignment('PLAN_STEP_FILES', spec.planStepFiles.join(' ')),
    assignment('COMMITS_EVERYTHING', spec.commitsEverything ? 'yes' : 'no'),
    assignment('IDENTIFYING_PREFIX', IDENTIFYING_PREFIX),
    assignment('IDENTIFYING_SUFFIX', IDENTIFYING_SUFFIX),
    // A newline inside a JSON string is the two characters backslash and n.
    assignment('NL', '\\n'),
  ];
  return [...settings, chooseBehaviourFunction(spec.rules)].join('\n');
}

const SCRIPT_BODY_PATH = fileURLToPath(new URL('./feature-1103-cli.sh', import.meta.url));

/** Writes the script and the directory of its run log; the caller owns removing the directory and pointing CLAUDE_CODE_PATH at the script. */
export function writeStandInCli(spec: StandInSpec): InstalledStandIn {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'adw-1103-cli-'));
  const installed: InstalledStandIn = {
    dir,
    scriptPath: path.join(dir, 'claude-stand-in.sh'),
    runLogPath: path.join(dir, 'runs.jsonl'),
    promptDir: path.join(dir, 'prompts'),
  };
  fs.mkdirSync(path.join(dir, 'counters'));
  fs.mkdirSync(installed.promptDir);
  fs.writeFileSync(path.join(dir, 'filler.txt'), 'x'.repeat(fillerLength()));
  fs.writeFileSync(installed.scriptPath, `#!/bin/sh\n${configuration(spec, installed)}\n${fs.readFileSync(SCRIPT_BODY_PATH, 'utf8')}`, { mode: 0o755 });
  return installed;
}

interface LogEntry {
  event: 'started' | 'stopped' | 'completed' | 'abandoned' | 'unscripted' | 'failed';
  command: string;
  run: number;
}

const PROBLEM_EVENTS: readonly LogEntry['event'][] = ['abandoned', 'unscripted', 'failed'];

function startedContext({ command, run }: LogEntry, promptDir: string): ContextRecord {
  const prompt = fs.readFileSync(path.join(promptDir, `${run}.txt`), 'utf8');
  return { command, run, prompt, stopped: false, completed: false };
}

/** Every build agent run, in start order, folded from the append-only log. */
export function readRunLog({ runLogPath, promptDir }: Pick<InstalledStandIn, 'runLogPath' | 'promptDir'>): RunLog {
  if (!fs.existsSync(runLogPath)) return { contexts: [], problems: [] };
  const entries = fs.readFileSync(runLogPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as LogEntry);
  const contexts: ContextRecord[] = [];
  const problems = entries.filter(({ event }) => PROBLEM_EVENTS.includes(event)).map(({ event, command, run }) => `${command} run ${run} was ${event}`);

  for (const entry of entries.filter(({ command }) => BUILD_COMMANDS.includes(command))) {
    if (entry.event === 'started') {
      contexts.push(startedContext(entry, promptDir));
      continue;
    }
    const context = contexts.find(({ run }) => run === entry.run);
    if (entry.event === 'stopped' && context) context.stopped = true;
    if (entry.event === 'completed' && context) context.completed = true;
  }
  return { contexts, problems };
}
