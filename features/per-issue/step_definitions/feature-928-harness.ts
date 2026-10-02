/**
 * Shared harness for the @adw-928 scenarios: a recording stand-in for the Claude CLI,
 * the "ADW's own environment" bookkeeping, and the cleanup hooks.
 *
 * NEVER STARTS THE REAL CLAUDE CLI. The stand-in is a throwaway `bun` script that
 * `CLAUDE_CODE_PATH` points at. Each run appends one JSON record to a file whose
 * absolute path is baked into the script — a path passed through the environment would
 * be dropped by the launch allowlist, and a relative one would break the probes that
 * run in throwaway directories. `bun` is the interpreter because a `node` shebang
 * inherits NODE_OPTIONS=--import tsx and fails to resolve it from a temp cwd.
 */

import { Given, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { clearClaudeCodePathCache } from '../../../adws/core/environment.ts';
import { setGuardrailsGateDepsForTesting } from '../../../adws/core/guardrailsGate.ts';

export const VALID_TEXT = '[12]';
export const INVALID_TEXT = 'twelve';
export const VALIDATION_ERROR = 'the output is not an array of integers';
export const OUTPUT_SCHEMA: Record<string, unknown> = { type: 'array', items: { type: 'integer' } };

const ENVELOPE_DIR = path.resolve(process.cwd(), 'test/fixtures/jsonl/envelopes');

export interface StandInRecord {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly slashCommand: string | null;
  readonly promptArgs: readonly string[];
  readonly commandFileExists: boolean | null;
  readonly files: Readonly<Record<string, string>>;
}

interface StandIn {
  readonly recordPath: string;
}

const harness: {
  standIn: StandIn | null;
  savedEnv: Map<string, string | undefined>;
  tempDirs: string[];
} = { standIn: null, savedEnv: new Map(), tempDirs: [] };

export function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `adw-928-${prefix}-`));
  harness.tempDirs.push(dir);
  return dir;
}

/** `undefined` removes the variable. The first touch of a name saves its original value for `After`. */
export function setAdwEnv(name: string, value: string | undefined): void {
  if (!harness.savedEnv.has(name)) harness.savedEnv.set(name, process.env[name]);
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

const STAND_IN_SOURCE = String.raw`#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RECORD_PATH = __RECORD_PATH__;
const COUNTER_PATH = __COUNTER_PATH__;
const ENVELOPE_DIR = __ENVELOPE_DIR__;
const TEXT = __TEXT__;
const FIRST_RUN_TEXT = __FIRST_RUN_TEXT__;

function splitShellWords(input) {
  const words = [];
  let current = null;
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === "'") quoted = false; else current += ch;
    } else if (ch === "'") {
      quoted = true;
      current = current ?? '';
    } else if (ch === '\\' && i + 1 < input.length) {
      current = (current ?? '') + input[++i];
    } else if (/\s/.test(ch)) {
      if (current !== null) { words.push(current); current = null; }
    } else {
      current = (current ?? '') + ch;
    }
  }
  if (current !== null) words.push(current);
  return words;
}

function isExistingFile(candidate) {
  if (!candidate || candidate.length > 4096 || candidate.includes('\n')) return false;
  try { return existsSync(candidate) && statSync(candidate).isFile(); } catch { return false; }
}

function readCount() {
  try { return Number(readFileSync(COUNTER_PATH, 'utf-8')) || 0; } catch { return 0; }
}

const argv = process.argv.slice(2);
const prompt = argv.length > 0 ? argv[argv.length - 1] : '';
const words = splitShellWords(prompt);
const slashCommand = words.length > 0 && words[0].startsWith('/') ? words[0] : null;
const promptArgs = slashCommand === null ? [] : words.slice(1);
const commandFileExists = slashCommand === null
  ? null
  : existsSync(join(process.cwd(), '.claude', 'commands', slashCommand.slice(1) + '.md'));
const files = {};
for (const candidate of [...argv, ...promptArgs]) {
  if (isExistingFile(candidate)) files[candidate] = readFileSync(candidate, 'utf-8');
}

appendFileSync(RECORD_PATH, JSON.stringify({ argv, env: { ...process.env }, cwd: process.cwd(), slashCommand, promptArgs, commandFileExists, files }) + '\n');

const count = readCount();
writeFileSync(COUNTER_PATH, String(count + 1));

if (argv.includes('--version')) {
  process.stdout.write('2.1.282 (Claude Code)\n');
  process.exit(0);
}

const text = count === 0 && FIRST_RUN_TEXT !== null ? FIRST_RUN_TEXT : TEXT;
const readEnvelope = (name) => JSON.parse(readFileSync(join(ENVELOPE_DIR, name), 'utf-8'));
const system = readEnvelope('system-message.jsonl');
const assistant = readEnvelope('assistant-message.jsonl');
const result = readEnvelope('result-message.jsonl');
assistant.message.content = [{ type: 'text', text }];
result.result = text;
for (const line of [system, assistant, result]) process.stdout.write(JSON.stringify(line) + '\n');
process.exit(0);
`;

function fillTemplate(template: string, values: Readonly<Record<string, unknown>>): string {
  return Object.entries(values).reduce(
    (source, [placeholder, value]) => source.replace(placeholder, () => JSON.stringify(value)),
    template,
  );
}

/** `firstRunText` makes the first run answer with that text and every later run with `text`. */
export function installStandIn(options: { text?: string; firstRunText?: string } = {}): void {
  const dir = makeTempDir('claude');
  const recordPath = path.join(dir, 'records.jsonl');
  const scriptPath = path.join(dir, 'claude');
  const source = fillTemplate(STAND_IN_SOURCE, {
    __RECORD_PATH__: recordPath,
    __COUNTER_PATH__: path.join(dir, 'invocations'),
    __ENVELOPE_DIR__: ENVELOPE_DIR,
    __TEXT__: options.text ?? VALID_TEXT,
    __FIRST_RUN_TEXT__: options.firstRunText ?? null,
  });
  fs.writeFileSync(scriptPath, source, { mode: 0o755 });
  harness.standIn = { recordPath };
  setAdwEnv('CLAUDE_CODE_PATH', scriptPath);
  clearClaudeCodePathCache();
}

export function readRecords(): StandInRecord[] {
  const standIn = harness.standIn;
  assert.ok(standIn, 'Expected the Claude CLI stand-in to be installed first');
  if (!fs.existsSync(standIn.recordPath)) return [];
  return fs.readFileSync(standIn.recordPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as StandInRecord);
}

/** Fails when no process was started for the command. */
export function recordsStartedFor(command: string): StandInRecord[] {
  const records = readRecords();
  const matching = records.filter((record) => record.slashCommand === command);
  assert.ok(
    matching.length > 0,
    `Expected the Claude CLI to have been started for "${command}". Started for: ${JSON.stringify(records.map((r) => r.slashCommand))}`,
  );
  return matching;
}

export function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

/** One capture group holding the whole clause. A nested capture group would make cucumber pass its value instead of the clause. */
export const BODY_CLAUSE = '(does not ask for fast mode|asks for "[^"]*")';

const PLAIN_ISSUE_BODY = 'The change is small and has no special handling.';

/** For "asks for {string}" the quoted keyword is appended to a short issue text. */
export function issueBodyFor(clause: string): string {
  const keyword = /^asks for "([^"]*)"$/.exec(clause)?.[1];
  return keyword === undefined ? PLAIN_ISSUE_BODY : `${PLAIN_ISSUE_BODY} ${keyword}`;
}

/** A guardrails gate that never runs the real probe and never injects `--settings`. */
function quietGuardrailsGate(): void {
  setGuardrailsGateDepsForTesting({
    probeGuardrails: async () => ({ ok: false }),
    notifySlack: async () => undefined,
    getEnv: () => undefined,
  });
}

Before({ tags: '@adw-928' }, function () {
  harness.standIn = null;
  quietGuardrailsGate();
});

/** Undoes `installStandIn`, `setAdwEnv` and `makeTempDir`. The hooks here are scoped to `@adw-928`, so any other feature that uses them calls this from its own `After`. */
export function releaseHarness(): void {
  harness.savedEnv.forEach((original, name) => {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  });
  harness.savedEnv.clear();
  clearClaudeCodePathCache();
  harness.tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  harness.tempDirs = [];
  harness.standIn = null;
}

After({ tags: '@adw-928' }, function () {
  setGuardrailsGateDepsForTesting(null);
  releaseHarness();
});

Given('the Claude CLI is a recording stand-in', function () {
  installStandIn();
});

Given(
  'the Claude CLI is a recording stand-in that answers its first run with output that fails validation and every later run with valid output',
  function () {
    installStandIn({ firstRunText: INVALID_TEXT, text: VALID_TEXT });
  },
);

Given("ADW's own environment sets {string} to {string}", function (name: string, value: string) {
  setAdwEnv(name, value);
});

Given("ADW's own environment leaves {string} unset", function (name: string) {
  setAdwEnv(name, undefined);
});
