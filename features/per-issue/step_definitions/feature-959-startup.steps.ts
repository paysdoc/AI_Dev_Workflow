/**
 * §5 NO SILENT DEATHS. Each row launches the REAL orchestrator script, never through a `bunx`
 * shadow, the way the cron launches one: `bunx tsx <script> <issue> <adwId> --target-repo <repo>`,
 * detached, stdio ignored, from the ADW checkout. The Claude CLI it is configured to run exists
 * but has no execute bit, so `initializeWorkflow`'s pre-flight check throws before any forge or
 * git access. The assertions read only runtime artefacts: the exit code and the orchestrator's
 * own execution log.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { spawn, type ChildProcess } from 'child_process';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { AGENTS_STATE_DIR, REPO_ROOT } from '../../../adws/core/config.ts';
import type { AgentIdentifier } from '../../../adws/types/agentTypes.ts';
import { s } from './feature-959-world.ts';

const STARTUP_EXIT_WAIT_MS = 45_000;
const GITHUB_APP_VARIABLES = ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY_PATH'] as const;

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`The launched orchestrator did not exit within ${timeoutMs} ms`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? -1);
    });
  });
}

/** `.env` never overrides a variable that is already set, so a blank value keeps App credentials out of the child. */
function childEnvironment(): NodeJS.ProcessEnv {
  const blanked = Object.fromEntries(GITHUB_APP_VARIABLES.map((name) => [name, '']));
  return { ...process.env, ...blanked, CLAUDE_CODE_PATH: s.nonExecutableCli };
}

function executionLogPath(orchestrator: string, adwId: string): string {
  return path.join(AGENTS_STATE_DIR, adwId, orchestrator, 'execution.log');
}

function readExecutionLogLines(orchestrator: string, adwId: string): string[] {
  const file = executionLogPath(orchestrator, adwId);
  assert.ok(fs.existsSync(file), `Expected the execution log ${file} to exist`);
  return fs.readFileSync(file, 'utf-8').split('\n');
}

function lineTimestamp(line: string): number {
  const match = /^\[([^\]]+)\]/.exec(line);
  return match ? Date.parse(match[1]) : Number.NaN;
}

/** The index of the first line, written by this launch, that names the path the pre-flight check rejected. */
function startupErrorLineIndex(lines: readonly string[]): number {
  return lines.findIndex((line) => line.includes(s.nonExecutableCli) && lineTimestamp(line) >= s.launchStartedAt);
}

Given('the Claude CLI that ADW is configured to run exists but is not executable', function () {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'adw-959-claude-'));
  const cli = path.join(dir, 'claude-not-executable');
  fs.writeFileSync(cli, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(cli, 0o644);
  s.tempDirs.push(dir);
  s.nonExecutableCli = cli;
});

Given(
  'the execution log of the {string} for adwId {string} already ends with the line {string}',
  function (orchestrator: string, adwId: string, line: string) {
    s.usedAdwIds.add(adwId);
    s.seededLogs.add(adwId);
    const statePath = AgentStateManager.initializeState(adwId, orchestrator as AgentIdentifier);
    AgentStateManager.appendLog(statePath, line);
  },
);

When(
  'the orchestrator {string} is launched as the cron launches it, for issue {int} under adwId {string} and the target repository {string}, with its output discarded',
  async function (this: RegressionWorld, script: string, issueNumber: number, adwId: string, targetRepo: string) {
    assert.ok(s.nonExecutableCli, 'Expected the non-executable Claude CLI to have been set up first');
    s.usedAdwIds.add(adwId);
    if (!s.seededLogs.has(adwId)) fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });

    s.launchStartedAt = Date.now();
    const child = spawn('bunx', ['tsx', path.join(REPO_ROOT, script), String(issueNumber), adwId, '--target-repo', targetRepo], {
      detached: true,
      stdio: 'ignore',
      cwd: REPO_ROOT,
      env: childEnvironment(),
    });
    this.lastExitCode = await waitForExit(child, STARTUP_EXIT_WAIT_MS);
  },
);

Then(
  'the execution log of the {string} for adwId {string} records the error that stopped its startup',
  function (orchestrator: string, adwId: string) {
    const lines = readExecutionLogLines(orchestrator, adwId);
    assert.ok(
      startupErrorLineIndex(lines) >= 0,
      `Expected the log of ${orchestrator} for ${adwId} to name the rejected path ${s.nonExecutableCli}, it holds:\n${lines.join('\n')}`,
    );
  },
);

Then(
  'the execution log of the {string} for adwId {string} still holds the line {string}',
  function (orchestrator: string, adwId: string, line: string) {
    const lines = readExecutionLogLines(orchestrator, adwId);
    assert.ok(lines.some((candidate) => candidate.includes(line)), `Expected the log of ${orchestrator} for ${adwId} to keep "${line}", it holds:\n${lines.join('\n')}`);
  },
);

Then(
  'the execution log of the {string} for adwId {string} records the error that stopped its startup, after the line {string}',
  function (orchestrator: string, adwId: string, line: string) {
    const lines = readExecutionLogLines(orchestrator, adwId);
    const earlier = lines.findIndex((candidate) => candidate.includes(line));
    const error = startupErrorLineIndex(lines);
    assert.ok(earlier >= 0, `Expected the log of ${orchestrator} for ${adwId} to hold "${line}", it holds:\n${lines.join('\n')}`);
    assert.ok(error > earlier, `Expected the startup error (line ${error}) after "${line}" (line ${earlier}), the log holds:\n${lines.join('\n')}`);
  },
);
