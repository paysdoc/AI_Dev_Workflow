/**
 * The throwaway programs a feature-990 target repository runs: a dev server that records where it started and
 * stopped, a scenario runner that answers with the outcome a scenario's table gives for the checkout it runs in, and
 * a wrapper around the Claude CLI stub that records every start. Each is a plain CommonJS file written into the
 * scenario's scratch directory, so nothing here touches the fixture's repository. Paths are baked into the source,
 * since the environment a workflow hands an agent or a check carries none of the harness's variables.
 */

import * as fs from 'fs';
import * as path from 'path';

export const BASE_WORKTREE_MARKER = '/.worktrees/base-issue-';
export const FIXED_MARKER_FILE = '.adw-scenarios-fixed';
export const NO_SERVER_MESSAGE = 'no dev server was started on this worktree';

export interface ScenarioOutcomes {
  readonly name: string;
  readonly feature: string;
  readonly tag: string;
  readonly onIssueBranch: 'fails' | 'passes';
  readonly onBaseBranch: 'fails' | 'passes' | 'does not exist';
}

export interface ScratchPaths {
  readonly dir: string;
  readonly checkLog: string;
  readonly serverLog: string;
  readonly runLog: string;
  readonly agentLog: string;
  readonly registryDir: string;
  /** The payload files the Claude CLI stub streams, one per command. */
  readonly answersDir: string;
  readonly serverScript: string;
  readonly runnerScript: string;
  readonly recorderScript: string;
  readonly runnerConfig: string;
}

export function scratchPaths(dir: string): ScratchPaths {
  return {
    dir,
    checkLog: path.join(dir, 'checks.log'),
    serverLog: path.join(dir, 'dev-server.log'),
    runLog: path.join(dir, 'scenario-runs.log'),
    agentLog: path.join(dir, 'agent-starts.log'),
    registryDir: path.join(dir, 'servers'),
    answersDir: path.join(dir, 'answers'),
    serverScript: path.join(dir, 'dev-server.cjs'),
    runnerScript: path.join(dir, 'run-scenarios.cjs'),
    recorderScript: path.join(dir, 'claude-recorder.cjs'),
    runnerConfig: path.join(dir, 'scenarios.json'),
  };
}

const literal = (value: string | null): string => JSON.stringify(value);

function devServerSource(paths: ScratchPaths): string {
  return `
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const here = fs.realpathSync(process.cwd());
const registryFile = path.join(${literal(paths.registryDir)}, crypto.createHash('sha1').update(here).digest('hex'));
const log = (line) => fs.appendFileSync(${literal(paths.serverLog)}, line + '\\n');
const port = Number(process.argv[2]);
const server = http.createServer((request, response) => { response.statusCode = 200; response.end(here); });
const stop = () => {
  fs.rmSync(registryFile, { force: true });
  log('stopped ' + here + ' ' + Date.now());
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.listen(port, () => {
  fs.mkdirSync(${literal(paths.registryDir)}, { recursive: true });
  fs.writeFileSync(registryFile, String(port));
  log('started ' + here + ' ' + Date.now());
});
`;
}

function runnerSource(paths: ScratchPaths, requiresServer: boolean): string {
  return `
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const config = JSON.parse(fs.readFileSync(${literal(paths.runnerConfig)}, 'utf-8'));
const tag = process.argv[2] || '';
const here = fs.realpathSync(process.cwd());
const onBase = here.includes(${literal(BASE_WORKTREE_MARKER)});

function featureFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : featureFiles(full);
    return entry.name.endsWith('.feature') ? [full] : [];
  });
}

function taggedScenarioNames(rerunTag) {
  const names = [];
  for (const file of featureFiles(path.join(here, 'features'))) {
    const lines = fs.readFileSync(file, 'utf-8').split(/\\r?\\n/);
    lines.forEach((line, index) => {
      if (!line.trim().split(/\\s+/).includes('@' + rerunTag)) return;
      const keyword = lines.slice(index + 1).find((candidate) => /^\\s*Scenario/.test(candidate));
      if (keyword) names.push(keyword.replace(/^\\s*Scenario(?: Outline)?:\\s*/, '').trim());
    });
  }
  return names;
}

function selected() {
  if (tag === 'adw-base-rerun') return config.scenarios.filter((scenario) => taggedScenarioNames(tag).includes(scenario.name));
  return config.scenarios.filter((scenario) => scenario.tag === '@' + tag);
}

function serverUp() {
  const registryFile = path.join(${literal(paths.registryDir)}, crypto.createHash('sha1').update(here).digest('hex'));
  if (!fs.existsSync(registryFile)) return Promise.resolve(false);
  const port = Number(fs.readFileSync(registryFile, 'utf-8'));
  return new Promise((resolve) => {
    http.get('http://localhost:' + port + '/', (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body === here));
    }).on('error', () => resolve(false));
  });
}

function outcomeOf(scenario, hasServer) {
  if (${requiresServer ? 'true' : 'false'} && !hasServer) return { passed: false, message: ${literal(NO_SERVER_MESSAGE)} };
  const fixed = fs.existsSync(path.join(here, ${literal(FIXED_MARKER_FILE)}));
  const verdict = onBase ? scenario.onBaseBranch : fixed ? 'passes' : scenario.onIssueBranch;
  return { passed: verdict === 'passes', message: 'assertion failed' };
}

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

(async () => {
  const hasServer = await serverUp();
  const results = selected().map((scenario) => ({ scenario, ...outcomeOf(scenario, hasServer) }));
  const failed = results.filter((result) => !result.passed);
  const cases = results.map(({ scenario, passed, message }) =>
    '<testcase classname="' + escapeXml(scenario.feature) + '" name="' + escapeXml(scenario.name) + '">' +
    (passed ? '' : '<failure message="' + escapeXml(message) + '"/>') + '</testcase>').join('');
  const report = '<?xml version="1.0" encoding="UTF-8"?><testsuite name="cucumber-js" tests="' + results.length + '" failures="' + failed.length + '">' + cases + '</testsuite>';
  if (process.env.ADW_JUNIT_REPORT_PATH) fs.writeFileSync(process.env.ADW_JUNIT_REPORT_PATH, report);

  fs.appendFileSync(${literal(paths.runLog)}, JSON.stringify({
    at: Date.now(), cwd: here, kind: onBase ? 'base' : 'issue', tag,
    scenarios: results.map(({ scenario, passed }) => ({ name: scenario.name, passed })),
  }) + '\\n');

  if (failed.length > 0) {
    console.log('Failures:\\n');
    failed.forEach(({ scenario, message }, index) => console.log((index + 1) + ') Scenario: ' + scenario.name + ' # ' + message));
  }
  console.log('\\n' + results.length + ' scenarios (' + failed.length + ' failed, ' + (results.length - failed.length) + ' passed)');
  process.exit(failed.length > 0 ? 1 : 0);
})();
`;
}

const BUILD_COMMAND = '/implement-tdd';

/**
 * Records every start, then hands the prompt to the Claude CLI stub. The build agent, when the scenario makes it fail,
 * is not handed on: it says the error, as an agent that failed with one does, and exits 1. The stub's own error
 * response carries no text, and the error a phase fails with is the text the agent said.
 */
function recorderSource(paths: ScratchPaths, stubPath: string, buildFailure: string | null): string {
  const envelopes = path.join(path.dirname(stubPath), '..', 'fixtures', 'jsonl', 'envelopes');
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const args = process.argv.slice(2);
fs.appendFileSync(${literal(paths.agentLog)}, JSON.stringify({ at: Date.now(), cwd: process.cwd(), args }) + '\\n');

const buildFailure = ${literal(buildFailure)};
if (buildFailure !== null && args.some((arg) => arg.startsWith(${literal(BUILD_COMMAND)}))) {
  const envelope = (name) => JSON.parse(fs.readFileSync(path.join(${literal(envelopes)}, name), 'utf-8'));
  const assistant = envelope('assistant-message.jsonl');
  assistant.message.content = [{ type: 'text', text: buildFailure }];
  const result = { ...envelope('result-message.jsonl'), is_error: true, api_error_status: null, result: buildFailure };
  process.stdout.write(JSON.stringify(assistant) + '\\n' + JSON.stringify(result) + '\\n');
  process.exit(1);
}

const result = spawnSync(${literal(stubPath)}, args, { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
`;
}

export interface ScriptOptions {
  readonly stubPath: string;
  readonly requiresServer: boolean;
  readonly scenarios: readonly ScenarioOutcomes[];
  /** The error the build agent fails with, or null. */
  readonly buildFailure: string | null;
}

export function writeScripts(paths: ScratchPaths, options: ScriptOptions): void {
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.serverScript, devServerSource(paths));
  fs.writeFileSync(paths.runnerScript, runnerSource(paths, options.requiresServer));
  fs.writeFileSync(paths.recorderScript, recorderSource(paths, options.stubPath, options.buildFailure), { mode: 0o755 });
  fs.writeFileSync(paths.runnerConfig, JSON.stringify({ scenarios: options.scenarios }));
}
