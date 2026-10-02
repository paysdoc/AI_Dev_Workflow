/**
 * The throwaway Claude CLI the feature-933 scenarios spawn in place of the real one.
 *
 * It picks its behaviour from the slash command at the start of its prompt (the last argv).
 * `/commit '<prefix>' '<context>'` does what the real `/commit` tells the agent to do: `git add -A`,
 * then `git commit -m "<prefix>: <description>"` in its working directory. It runs git with the
 * environment it was started with and sets no identity of its own (no `-c user.*`, no `--author`, no
 * `GIT_*` variable), so the commit carries whatever identity the phase gave the agent. Every other
 * command makes the one change its phase commits and ends with a final result that the phase's own
 * parser accepts. None of them commits.
 *
 * `getSafeSubprocessEnv()` filters the spawned CLI's environment, so nothing reaches the script
 * through `MOCK_*` variables: every absolute path is baked into the script when it is written.
 */

import * as fs from 'fs';
import * as path from 'path';
import { clearClaudeCodePathCache } from '../../../adws/core/environment.ts';

export interface CliRun {
  command: string;
  cwd: string;
  /** The GIT_AUTHOR_* / GIT_COMMITTER_* variables the run started with. Git reads them before any configuration. */
  identityEnv: Record<string, string>;
  commit?: string;
  failure?: string;
}

export interface InstalledCli {
  scriptPath: string;
  runLogPath: string;
}

/** Plain `var`/`function` source with no backtick and no `${`: it runs under whichever Node the harness runs under, with no loader. */
const SCRIPT_BODY = String.raw`
'use strict';
var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var IDENTITY_VARIABLES = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
var CHANGED_FILES = {
  '/implement': 'src/implemented.ts',
  '/implement-tdd': 'src/implemented.ts',
  '/patch': 'src/patched.ts',
  '/resolve_failed_scenario': 'src/resolved-scenario.ts',
  '/document': 'app_docs/feature-933-document.md'
};

var prompt = process.argv[process.argv.length - 1];
var matched = /^\/[A-Za-z0-9_-]+/.exec(prompt);
var command = matched ? matched[0] : '(no slash command)';
var args = shellWords(prompt.slice(command.length));
var sessionId = 'session-933-' + process.pid;
var run = { command: command, cwd: process.cwd(), identityEnv: identityEnv() };

function identityEnv() {
  var seen = {};
  IDENTITY_VARIABLES.forEach(function (name) {
    if (process.env[name] !== undefined) seen[name] = process.env[name];
  });
  return seen;
}

function shellWords(text) {
  var words = [];
  var word = '';
  var started = false;
  var quoted = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (quoted) {
      if (ch === "'") quoted = false; else word += ch;
    } else if (ch === "'") {
      quoted = true;
      started = true;
    } else if (ch === '\\' && i + 1 < text.length) {
      word += text.charAt(++i);
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) words.push(word);
      word = '';
      started = false;
    } else {
      word += ch;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}

function emit(message) { process.stdout.write(JSON.stringify(message) + '\n'); }

function say(text) {
  emit({ type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: text }] }, session_id: sessionId });
}

function finish(text, failed) {
  emit({
    type: 'result', subtype: failed ? 'error_during_execution' : 'success', is_error: !!failed, api_error_status: null,
    terminal_reason: 'completed', duration_ms: 1000, duration_api_ms: 900, num_turns: 1, result: text, stop_reason: 'end_turn',
    session_id: sessionId, total_cost_usd: 0.01,
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 },
    modelUsage: { 'claude-sonnet-4-6': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 50, cacheCreationInputTokens: 0, costUSD: 0.01 } },
    permission_denials: []
  });
  fs.appendFileSync(CONFIG.runLog, JSON.stringify(run) + '\n');
  process.exitCode = failed ? 1 : 0;
}

function git() {
  return childProcess.execFileSync('git', Array.prototype.slice.call(arguments), {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  });
}

function commit() {
  var message = (args[0] || 'commit') + ': commit the worktree changes';
  git('add', '-A');
  git('commit', '-m', message);
  run.commit = message;
  return message;
}

function changeFile(relativePath) {
  var file = path.resolve(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, (/\.ts$/.test(file) ? '// ' : '') + command + ' run ' + process.pid + '\n');
}

function alignPlan() {
  changeFile(args[2]);
  return JSON.stringify({ aligned: true, warnings: [], changes: ['Aligned the plan with the scenarios'], summary: 'Aligned the plan with the scenarios.' });
}

function result() {
  if (command === '/commit') return commit();
  if (command === '/align_plan_scenarios') return alignPlan();
  if (command === '/pull_request') return JSON.stringify({ title: 'Update the worktree', body: 'The changes the phase under test made.' });
  var changed = CHANGED_FILES[command];
  if (changed) changeFile(changed);
  return command === '/document' ? changed : 'Final result of ' + command;
}

emit({ type: 'system', subtype: 'init', session_id: sessionId });
try {
  var text = result();
  say(text);
  finish(text, false);
} catch (error) {
  var failure = String((error && error.stderr) || (error && error.message) || error);
  run.failure = failure;
  say(failure);
  finish(failure, true);
}
`;

function scriptSource(runLogPath: string): string {
  // A shebang cannot carry a path with spaces; `env` finds node on PATH instead.
  const interpreter = /\s/.test(process.execPath) ? '/usr/bin/env node' : process.execPath;
  return `#!${interpreter}\nvar CONFIG = ${JSON.stringify({ runLog: runLogPath })};\n${SCRIPT_BODY}`;
}

/** Writes the script into `dir` and points CLAUDE_CODE_PATH at it. The scenario's `After` hook puts the previous value back. */
export function installCli(dir: string): InstalledCli {
  const scriptPath = path.join(dir, 'claude-committing.cjs');
  const runLogPath = path.join(dir, 'runs.jsonl');
  fs.writeFileSync(scriptPath, scriptSource(runLogPath), { mode: 0o755 });

  process.env['CLAUDE_CODE_PATH'] = scriptPath;
  clearClaudeCodePathCache();
  return { scriptPath, runLogPath };
}

/** Every run the script served, in start order. */
export function readCliRuns(cli: InstalledCli): CliRun[] {
  if (!fs.existsSync(cli.runLogPath)) return [];
  return fs.readFileSync(cli.runLogPath, 'utf-8').split('\n').filter(Boolean).map(line => JSON.parse(line) as CliRun);
}
