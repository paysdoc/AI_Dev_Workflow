/**
 * Novel step definitions for feature-907.feature. Reuses feature-902's harness
 * (probeStub, the mock GitHub / gh-shadow infrastructure, the shared world getters)
 * rather than re-initialising it — see feature-902.steps.ts and feature-902-queue.steps.ts
 * for the Before/After hooks this file's scenarios also run under (widened to
 * `@adw-902 or @adw-907`).
 */

import { When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { clearClaudeCodePathCache } from '../../../adws/core/index.ts';
import { runClaudeAgentWithCommand } from '../../../adws/agents/claudeAgent.ts';
import { RateLimitError } from '../../../adws/types/agentTypes.ts';
import type { ProbeExecResult } from '../../../adws/triggers/rateLimitProbe.ts';
import { probeStub, getLastProbeClassification, getLastAgentRunResult } from './feature-902.steps.ts';

function withTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * Never spawns the real Claude CLI: a throwaway shell script that replays the
 * exact stdout/stderr/exit code already stubbed for the probe, so the same
 * Claude CLI output can be asserted against both the probe and a real agent run.
 */
function writeThrowawayClaudeScript(result: ProbeExecResult): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'adw-907-agent-cli-'));
  const stdoutPath = path.join(dir, 'stdout.txt');
  const stderrPath = path.join(dir, 'stderr.txt');
  fs.writeFileSync(stdoutPath, withTrailingNewline(result.stdout), 'utf-8');
  fs.writeFileSync(stderrPath, withTrailingNewline(result.stderr), 'utf-8');

  const scriptPath = path.join(dir, 'claude');
  const exitCode = result.status ?? 0;
  const script = [
    '#!/bin/sh',
    `cat "${stdoutPath}"`,
    `cat "${stderrPath}" 1>&2`,
    `exit ${exitCode}`,
    '',
  ].join('\n');
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

const world: {
  thrownAgentError: unknown;
  savedClaudeCodePath: string | undefined;
} = {
  thrownAgentError: null,
  savedClaudeCodePath: undefined,
};

let capturedLogLines: string[] = [];
let originalConsoleLog: typeof console.log | null = null;

Before({ tags: '@adw-907' }, function () {
  world.thrownAgentError = null;
  capturedLogLines = [];
  originalConsoleLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    capturedLogLines.push(args.map(String).join(' '));
    originalConsoleLog!(...args);
  };
});

After({ tags: '@adw-907' }, function () {
  if (originalConsoleLog) {
    console.log = originalConsoleLog;
    originalConsoleLog = null;
  }
  clearClaudeCodePathCache();
  if (world.savedClaudeCodePath === undefined) {
    delete process.env['CLAUDE_CODE_PATH'];
  } else {
    process.env['CLAUDE_CODE_PATH'] = world.savedClaudeCodePath;
  }
  world.savedClaudeCodePath = undefined;
  clearClaudeCodePathCache();
});

When('an agent command runs against the same Claude CLI output', async function () {
  const scriptPath = writeThrowawayClaudeScript(probeStub.result);

  // Point CLAUDE_CODE_PATH at the throwaway script AFTER the mock-infrastructure
  // hook has run (it points CLAUDE_CODE_PATH at the claude-cli-stub).
  world.savedClaudeCodePath = process.env['CLAUDE_CODE_PATH'];
  process.env['CLAUDE_CODE_PATH'] = scriptPath;
  clearClaudeCodePathCache();

  const cwd = fs.mkdtempSync(path.join(tmpdir(), 'adw-907-agent-cwd-'));
  const outputFile = path.join(cwd, 'output.jsonl');

  world.thrownAgentError = null;
  try {
    await runClaudeAgentWithCommand(
      '/feature-907-probe', 'probe', 'feature-907-agent', outputFile,
      'sonnet', undefined, undefined, undefined, cwd,
    );
  } catch (err) {
    world.thrownAgentError = err;
  }

  clearClaudeCodePathCache();
});

function requireRateLimitError(): RateLimitError {
  assert.ok(
    world.thrownAgentError instanceof RateLimitError,
    `Expected a RateLimitError, got: ${world.thrownAgentError instanceof Error ? world.thrownAgentError.stack : String(world.thrownAgentError)}`,
  );
  return world.thrownAgentError as RateLimitError;
}

Then('the agent command fails with a rate-limit error', function () {
  requireRateLimitError();
});

function resetsAtMillis(resetsAt: number | undefined): number | undefined {
  return resetsAt === undefined ? undefined : resetsAt * 1000;
}

Then('the rate-limit error carries a {string} limit that resets at {string}', function (limitType: string, isoTimestamp: string) {
  const err = requireRateLimitError();
  assert.strictEqual(err.rateLimitType, limitType);
  assert.strictEqual(resetsAtMillis(err.resetsAt), new Date(isoTimestamp).getTime());
});

Then('the rate-limit error carries a {string} limit with no reset time', function (limitType: string) {
  const err = requireRateLimitError();
  assert.strictEqual(err.rateLimitType, limitType);
  assert.strictEqual(err.resetsAt, undefined);
});

Then('the rate-limit error carries no limit type and no reset time', function () {
  const err = requireRateLimitError();
  assert.strictEqual(err.rateLimitType, undefined);
  assert.strictEqual(err.resetsAt, undefined);
});

Then('the rate-limit probe reports a {string} limit that resets at {string}', function (limitType: string, isoTimestamp: string) {
  const classification = getLastProbeClassification();
  assert.ok(classification, 'Expected the rate-limit probe to have run first');
  assert.strictEqual(classification!.rateLimitType, limitType);
  assert.strictEqual(resetsAtMillis(classification!.resetsAt), new Date(isoTimestamp).getTime());
});

Then('the rate-limit probe reports a {string} limit with no reset time', function (limitType: string) {
  const classification = getLastProbeClassification();
  assert.ok(classification, 'Expected the rate-limit probe to have run first');
  assert.strictEqual(classification!.rateLimitType, limitType);
  assert.strictEqual(classification!.resetsAt, undefined);
});

Then('the rate-limit probe reports no limit type and no reset time', function () {
  const classification = getLastProbeClassification();
  assert.ok(classification, 'Expected the rate-limit probe to have run first');
  assert.strictEqual(classification!.rateLimitType, undefined);
  assert.strictEqual(classification!.resetsAt, undefined);
});

Then('the rate-limit probe reports a confirmed non-rate-limit failure', function () {
  const classification = getLastProbeClassification();
  assert.ok(classification, 'Expected the rate-limit probe to have run first');
  assert.notStrictEqual(classification!.verdict, 'clear', 'A confirmed failure must not be "clear"');
  assert.notStrictEqual(classification!.verdict, 'limited', 'A confirmed failure must not be "limited"');
  assert.notStrictEqual(classification!.verdict, 'unknown', 'A confirmed failure must not be "unknown" — that verdict is reserved for output with no JSON');
});

Then('the agent run ends with an authentication failure', function () {
  const result = getLastAgentRunResult();
  assert.ok(result, 'Expected an agent run to have completed first');
  assert.strictEqual(result!.authExpired, true, `Expected authExpired: true, got: ${JSON.stringify(result)}`);
});

Then('the agent run does not end rate-limited', function () {
  const result = getLastAgentRunResult();
  assert.ok(result, 'Expected an agent run to have completed first');
  assert.notStrictEqual(result!.rateLimited, true, `Expected rateLimited not to be true, got: ${JSON.stringify(result)}`);
});

Then('the rate-limit probe logged a warning quoting {string}', function (text: string) {
  const found = capturedLogLines.some(line => line.includes(text));
  assert.ok(found, `Expected a logged warning quoting "${text}", got:\n${capturedLogLines.join('\n')}`);
});
