/**
 * The throwaway Claude CLI the feature-929 scenarios spawn in place of the real one.
 *
 * It picks its behaviour from the slash command at the start of its prompt (the last argv)
 * and from how many times that command has already run. A run that compacts streams an
 * init line and partial output, reports `compact_boundary`, waits for a while (so a handler
 * that stops agents on compaction has done so before the run carries on), then streams the
 * rest and a final `result`. It records whether it was stopped by SIGTERM or reached its
 * natural end. Every other run streams its lines at once.
 *
 * `getSafeSubprocessEnv()` filters the spawned CLI's environment, so nothing reaches the
 * script through `MOCK_*` variables: every absolute path (run log, per-command counters,
 * JUnit report) and every behaviour is baked into the script when it is written.
 */

import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { clearClaudeCodePathCache } from '../../../adws/core/environment.ts';

export interface RunRecord {
  command: string;
  run: number;
  prompt: string;
  stopped: boolean;
  completed: boolean;
  /** The `result` text the run streamed; set only once it reached its natural end. */
  finalResult?: string;
}

export interface CliBehaviour {
  /** Commands whose first run compacts partway through. */
  compactFirstRunOf: string[];
  /** Text a run of the command streams before it compacts. */
  draftBeforeCompaction: Record<string, string>;
  /** `result` text of a completed run of the command. Commands not listed stream a default their parser accepts. */
  finalResult: Record<string, string>;
  /** When set, every completed `/test` run writes its JUnit report here. */
  junitReportPath?: string;
  /** The `/test` runs (1-based) whose report carries one failing unit test. */
  failingTestRuns: number[];
}

export interface InstalledCli {
  dir: string;
  runLogPath: string;
  restore: () => void;
}

export function emptyBehaviour(): CliBehaviour {
  return { compactFirstRunOf: [], draftBeforeCompaction: {}, finalResult: {}, failingTestRuns: [] };
}

const COMPACTION_WAIT_MS = 2000;

/** Plain `function`/`var` source: the script runs under whichever Node the harness runs under, with no loader. */
const SCRIPT_BODY = `
'use strict';
var fs = require('fs');
var path = require('path');

var prompt = process.argv[process.argv.length - 1];
var matched = /^\\/[A-Za-z0-9_-]+/.exec(prompt);
var command = matched ? matched[0] : '(no slash command)';

function nextRunNumber() {
  fs.mkdirSync(CONFIG.counterDir, { recursive: true });
  var file = path.join(CONFIG.counterDir, command.replace(/[^A-Za-z0-9_-]/g, '_'));
  var count = 0;
  try { count = Number(fs.readFileSync(file, 'utf8')) || 0; } catch (e) { count = 0; }
  fs.writeFileSync(file, String(count + 1));
  return count + 1;
}

var run = nextRunNumber();

function record(entry) {
  fs.appendFileSync(CONFIG.runLog, JSON.stringify(Object.assign({ command: command, run: run }, entry)) + '\\n');
}

process.on('SIGTERM', function () {
  record({ event: 'stopped' });
  process.exit(143);
});
record({ event: 'started', prompt: prompt });

var sessionId = 'session-' + command.slice(1) + '-' + run;
function emit(message) { process.stdout.write(JSON.stringify(message) + '\\n'); }
function say(text) {
  emit({ type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: text }] }, session_id: sessionId });
}

var failingRun = command === '/test' && CONFIG.failingTestRuns.indexOf(run) !== -1;

var DEFAULT_RESULTS = {
  '/test': JSON.stringify([{ test_name: 'app_tests', passed: !failingRun, execution_command: 'bun run test:unit', test_purpose: 'unit tests', testcase_count: 1 }]),
  '/review': JSON.stringify({ success: true, reviewSummary: 'No blockers.', reviewIssues: [], screenshots: [] }),
  '/generate_step_definitions': JSON.stringify({ removedScenarios: [] }),
  '/document': 'app_docs/feature-929-compaction.md'
};

function resultText() {
  if (CONFIG.finalResult[command] !== undefined) return CONFIG.finalResult[command];
  if (DEFAULT_RESULTS[command] !== undefined) return DEFAULT_RESULTS[command];
  return 'Final result of ' + command + ' run ' + run;
}

function writeJunitReport() {
  if (command !== '/test' || !CONFIG.junitReportPath) return;
  var xml = failingRun
    ? '<testsuite tests="1" failures="1"><testcase classname="Suite" name="breaks"><failure message="expected true to be false"/></testcase></testsuite>'
    : '<testsuite tests="1"><testcase classname="Suite" name="works"/></testsuite>';
  fs.mkdirSync(path.dirname(CONFIG.junitReportPath), { recursive: true });
  fs.writeFileSync(CONFIG.junitReportPath, xml);
}

var compacts = run === 1 && CONFIG.compactFirstRunOf.indexOf(command) !== -1;

function complete() {
  if (compacts) say('Output of ' + command + ' run ' + run + ' after the compaction');
  writeJunitReport();
  var text = resultText();
  emit({
    type: 'result', subtype: 'success', is_error: false, api_error_status: null, terminal_reason: 'completed',
    duration_ms: 5000, duration_api_ms: 4500, num_turns: 3, result: text, stop_reason: 'end_turn', session_id: sessionId,
    total_cost_usd: 0.05,
    usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 500 },
    modelUsage: { 'claude-sonnet-4-6': { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 500, cacheCreationInputTokens: 0, costUSD: 0.05 } },
    permission_denials: []
  });
  record({ event: 'completed', result: text });
}

emit({ type: 'system', subtype: 'init', session_id: sessionId });
if (compacts) {
  say(CONFIG.draftBeforeCompaction[command] || ('Partial output of ' + command + ' run ' + run));
  emit({ type: 'system', subtype: 'compact_boundary' });
  setTimeout(complete, CONFIG.waitMs);
} else {
  say('Working on ' + command + ' run ' + run);
  complete();
}
`;

function scriptSource(config: Record<string, unknown>): string {
  // A shebang cannot carry a path with spaces; `env` finds node on PATH instead.
  const interpreter = /\s/.test(process.execPath) ? '/usr/bin/env node' : process.execPath;
  return `#!${interpreter}\nvar CONFIG = ${JSON.stringify(config)};\n${SCRIPT_BODY}`;
}

/**
 * Points CLAUDE_CODE_PATH at a freshly written script that behaves as `behaviour` says.
 * `restore()` puts the previous value back and clears the cached CLI path, as the
 * `@adw-929` After hook needs to do even when a scenario fails.
 */
export function installCompactingCli(behaviour: CliBehaviour): InstalledCli {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'adw-929-cli-'));
  const runLogPath = path.join(dir, 'runs.jsonl');
  const scriptPath = path.join(dir, 'claude-compacting.cjs');
  const config = {
    ...behaviour,
    runLog: runLogPath,
    counterDir: path.join(dir, 'counters'),
    waitMs: COMPACTION_WAIT_MS,
  };
  fs.writeFileSync(scriptPath, scriptSource(config), { mode: 0o755 });

  const savedPath = process.env['CLAUDE_CODE_PATH'];
  process.env['CLAUDE_CODE_PATH'] = scriptPath;
  clearClaudeCodePathCache();

  return {
    dir,
    runLogPath,
    restore: () => {
      if (savedPath === undefined) delete process.env['CLAUDE_CODE_PATH'];
      else process.env['CLAUDE_CODE_PATH'] = savedPath;
      clearClaudeCodePathCache();
    },
  };
}

interface LogEntry {
  event: 'started' | 'stopped' | 'completed';
  command: string;
  run: number;
  prompt?: string;
  result?: string;
}

/** Every run the script served, in start order, folded from its append-only log. */
export function readRuns(runLogPath: string): RunRecord[] {
  if (!fs.existsSync(runLogPath)) return [];
  const entries = fs.readFileSync(runLogPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as LogEntry);
  const runs: RunRecord[] = [];
  for (const entry of entries) {
    if (entry.event === 'started') {
      runs.push({ command: entry.command, run: entry.run, prompt: entry.prompt ?? '', stopped: false, completed: false });
      continue;
    }
    const record = runs.find(r => r.command === entry.command && r.run === entry.run);
    if (!record) continue;
    if (entry.event === 'stopped') record.stopped = true;
    if (entry.event === 'completed') {
      record.completed = true;
      record.finalResult = entry.result;
    }
  }
  return runs;
}
