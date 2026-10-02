/**
 * The tools a workflow run finds on its PATH instead of the real ones. NEVER THE REAL CLAUDE CLI,
 * and nothing is ever installed: `claude` answers from a script, `npm` records the version it is
 * asked to install and installs nothing, and the `bun` shadow turns `bun install` into a no-op and
 * hands every other command to the real bun.
 *
 * The probe starts `claude` through `getSafeSubprocessEnv()`, which keeps PATH and ANTHROPIC_API_KEY
 * but drops every other name, so the stand-in has the paths of its files written into its script.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface StandInPaths {
  /** Holds the `claude` and `npm` stand-ins. */
  readonly binDir: string;
  /** Holds the `bun` shadow. */
  readonly shadowDir: string;
  /** One JSON line per call to `claude`: its arguments and the ANTHROPIC_API_KEY it received. */
  readonly recordPath: string;
  /** The version `npm install -g @anthropic-ai/claude-code@<version>` recorded. */
  readonly versionPath: string;
  /** The scripted answer to a probe request, one message per line. */
  readonly answerPath: string;
}

export interface ClaudeCall {
  readonly args: readonly string[];
  /** An empty value counts as none. */
  readonly apiKey: string | null;
}

const FIXTURE_DIR = 'adws/jsonl/fixtures';

function fixtureLines(repoRoot: string, name: string): string[] {
  return fs.readFileSync(path.join(repoRoot, FIXTURE_DIR, name), 'utf-8').split('\n').filter(line => line.trim() !== '');
}

function isInit(line: string): boolean {
  const message = JSON.parse(line) as Record<string, unknown>;
  return message['type'] === 'system' && message['subtype'] === 'init';
}

/**
 * A one-turn session built from committed real captures: the `system/init` line of a recorded
 * session, an assistant message and a success result. It has no rate-limit event, as no answer to
 * a probe authenticated by API key does. The stand-in sets the init line's version to its own.
 */
export function conformingSession(repoRoot: string): string[] {
  const init = fixtureLines(repoRoot, 'session-rate-limited.jsonl').find(isInit);
  if (init === undefined) throw new Error(`${FIXTURE_DIR}/session-rate-limited.jsonl holds no system/init message`);
  return [init, ...fixtureLines(repoRoot, 'assistant-text.jsonl'), ...fixtureLines(repoRoot, 'result-success.jsonl')];
}

function withoutFieldOf(messageType: string, field: string): (line: string) => string {
  return line => {
    const message = JSON.parse(line) as Record<string, unknown>;
    if (message['type'] !== messageType) return line;
    const { [field]: _removed, ...rest } = message;
    return JSON.stringify(rest);
  };
}

/** Deletes the top-level `field` from every message of type `messageType`. */
export function withoutField(session: readonly string[], messageType: string, field: string): string[] {
  const answer = session.map(withoutFieldOf(messageType, field));
  if (answer.every((line, index) => line === session[index])) {
    throw new Error(`No "${messageType}" message of the session carries the field "${field}"`);
  }
  return answer;
}

export function readCalls(recordPath: string): ClaudeCall[] {
  if (!fs.existsSync(recordPath)) return [];
  return fs.readFileSync(recordPath, 'utf-8').split('\n').filter(line => line !== '').map(line => JSON.parse(line) as ClaudeCall);
}

/** Any call other than `--version` is a request for the probe. */
export const isProbeRequest = (call: ClaudeCall): boolean => !(call.args.length === 1 && call.args[0] === '--version');

function claudeSource(paths: StandInPaths): string {
  return `#!/usr/bin/env node
const fs = require('fs');
const RECORD = ${JSON.stringify(paths.recordPath)};
const VERSION = ${JSON.stringify(paths.versionPath)};
const ANSWER = ${JSON.stringify(paths.answerPath)};

function withInstalledVersion(line, installed) {
  const message = JSON.parse(line);
  const isInit = message.type === 'system' && message.subtype === 'init';
  return JSON.stringify(isInit && installed !== null ? Object.assign({}, message, { claude_code_version: installed }) : message);
}

function main() {
  const args = process.argv.slice(2);
  const apiKey = process.env.ANTHROPIC_API_KEY || null;
  fs.appendFileSync(RECORD, JSON.stringify({ args: args, apiKey: apiKey }) + '\\n');
  const installed = fs.existsSync(VERSION) ? fs.readFileSync(VERSION, 'utf-8').trim() : null;

  if (args.length === 1 && args[0] === '--version') {
    if (installed === null) {
      process.stderr.write('claude: command not found\\n');
      process.exitCode = 127;
      return;
    }
    process.stdout.write(installed + ' (Claude Code)\\n');
    return;
  }
  if (apiKey === null) {
    process.stderr.write('Not logged in \\u00b7 Please run /login\\n');
    process.exitCode = 1;
    return;
  }
  const lines = fs.readFileSync(ANSWER, 'utf-8').split('\\n').filter(Boolean);
  process.stdout.write(lines.map(function (line) { return withInstalledVersion(line, installed); }).join('\\n') + '\\n');
}

main();
`;
}

function npmSource(paths: StandInPaths): string {
  return `#!/usr/bin/env node
const fs = require('fs');
const VERSION = ${JSON.stringify(paths.versionPath)};
const PACKAGE = '@anthropic-ai/claude-code@';

const args = process.argv.slice(2);
const spec = args.find(function (arg) { return arg.startsWith(PACKAGE); });
const installsGlobally = ['install', 'i', 'add'].includes(args[0]) && (args.includes('-g') || args.includes('--global'));
if (installsGlobally && spec !== undefined) {
  fs.writeFileSync(VERSION, spec.slice(PACKAGE.length));
} else {
  process.stderr.write('npm stand-in: unsupported call: npm ' + args.join(' ') + '\\n');
  process.exitCode = 1;
}
`;
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

function bunShadowSource(realBun: string): string {
  return `#!/bin/sh\nif [ "$1" = "install" ]; then exit 0; fi\nexec ${shellQuote(realBun)} "$@"\n`;
}

function writeExecutable(file: string, source: string): void {
  fs.writeFileSync(file, source);
  fs.chmodSync(file, 0o755);
}

export function writeStandIns(paths: StandInPaths, answer: readonly string[], realBun: string): void {
  writeExecutable(path.join(paths.binDir, 'claude'), claudeSource(paths));
  writeExecutable(path.join(paths.binDir, 'npm'), npmSource(paths));
  writeExecutable(path.join(paths.shadowDir, 'bun'), bunShadowSource(realBun));
  fs.writeFileSync(paths.answerPath, answer.map(line => `${line}\n`).join(''));
}
