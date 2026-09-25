/**
 * §1 and §2 drive the real `probeRateLimit`/`classifyProbeResult` and the real
 * `handleAgentProcess` directly, with the Claude CLI replaced by an injected stub exec
 * (never a spawned process) so the same canned stream-json reply can be asserted against
 * both detectors side by side. §3's queue-level steps and shared Before/After hooks live
 * in `feature-902-queue.steps.ts`.
 */

import { Given, When, Then, Before } from '@cucumber/cucumber';
import assert from 'assert';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import type { ChildProcess } from 'child_process';

import { probeRateLimit, type ProbeExec, type ProbeExecResult, type ProbeOutcome } from '../../../adws/triggers/rateLimitProbe.ts';
import { handleAgentProcess } from '../../../adws/agents/agentProcessHandler.ts';
import type { AgentResult } from '../../../adws/types/agentTypes.ts';

interface ProbeStubCall {
  claudePath: string;
  args: readonly string[];
}

export const probeStub: {
  result: ProbeExecResult;
  calls: ProbeStubCall[];
  exec: ProbeExec;
  reset: () => void;
} = {
  result: { status: 0, stdout: '', stderr: '' },
  calls: [],
  exec(claudePath: string, args: readonly string[]): ProbeExecResult {
    probeStub.calls.push({ claudePath, args });
    return probeStub.result;
  },
  reset(): void {
    probeStub.result = { status: 0, stdout: '', stderr: '' };
    probeStub.calls = [];
  },
};

const world: {
  lastOutcome: ProbeOutcome | null;
  agentResult: AgentResult | null;
} = {
  lastOutcome: null,
  agentResult: null,
};

export function resetFeature902ProbeState(): void {
  probeStub.reset();
  world.lastOutcome = null;
  world.agentResult = null;
}

Before({ tags: '@adw-902' }, function () {
  resetFeature902ProbeState();
});

Given(
  'the Claude CLI answers the rate-limit probe with exit code {int} and {word}:',
  function (exitCode: number, stream: string, body: string) {
    assert.ok(stream === 'stdout' || stream === 'stderr', `Unknown output stream "${stream}" — expected "stdout" or "stderr"`);
    probeStub.result = {
      status: exitCode,
      stdout: stream === 'stdout' ? body : '',
      stderr: stream === 'stderr' ? body : '',
    };
  },
);

When('the rate-limit probe runs', function () {
  world.lastOutcome = probeRateLimit(probeStub.exec);
});

Then('the rate-limit probe reports {string}', function (expected: string) {
  assert.strictEqual(world.lastOutcome, expected, `Expected probe outcome "${expected}" but got "${world.lastOutcome}"`);
});

function lastProbeCall(): ProbeStubCall {
  const call = probeStub.calls[probeStub.calls.length - 1];
  assert.ok(call, 'Expected the rate-limit probe to have invoked its exec seam at least once');
  return call;
}

Then('the rate-limit probe requested {string} output from the Claude CLI', function (format: string) {
  const call = lastProbeCall();
  const idx = call.args.indexOf('--output-format');
  assert.ok(idx !== -1, `Expected --output-format among the probe's args: ${JSON.stringify(call.args)}`);
  assert.strictEqual(call.args[idx + 1], format);
});

Then('the rate-limit probe requested verbose output from the Claude CLI', function () {
  const call = lastProbeCall();
  assert.ok(call.args.includes('--verbose'), `Expected --verbose among the probe's args: ${JSON.stringify(call.args)}`);
});

/**
 * A minimal fake ChildProcess: real EventEmitters for stdout/stderr/close/error (exactly
 * what handleAgentProcess listens on), and a `kill` that only records the call — the
 * step below decides the resulting close code from that record, rather than letting
 * `kill` re-enter `emit('close', ...)` itself and risk a double-fire.
 */
function createFakeAgentChild(): { child: ChildProcess; wasKilled: () => boolean } {
  const emitter = new EventEmitter() as unknown as ChildProcess & { stdout: EventEmitter; stderr: EventEmitter };
  (emitter as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
  (emitter as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  let killed = false;
  (emitter as unknown as { kill: () => void }).kill = () => { killed = true; };
  return { child: emitter as unknown as ChildProcess, wasKilled: () => killed };
}

When('the same Claude CLI output is streamed through an agent run', async function () {
  const { child, wasKilled } = createFakeAgentChild();
  const outputDir = fs.mkdtempSync(path.join(tmpdir(), 'adw-902-agent-'));
  const outputFile = path.join(outputDir, 'output.jsonl');

  const resultPromise = handleAgentProcess(child, 'adw-902-parity-agent', outputFile, undefined, undefined, 'haiku');

  const content = probeStub.result.stdout;
  (child.stdout as unknown as EventEmitter).emit('data', Buffer.from(content));
  (child as unknown as EventEmitter).emit('close', wasKilled() ? null : 0);

  // Not cleaned up synchronously: agentProcessHandler's internal fs.createWriteStream
  // opens asynchronously, and its queued open/write/close can still be in flight here —
  // removing the directory immediately races it and crashes the process with an
  // unhandled ENOENT (no error listener is attached to that internal stream). The file
  // is a few bytes in the OS tmp dir; leaving it behind is the safe tradeoff.
  world.agentResult = await resultPromise;
});

Then('the agent run ends rate-limited', function () {
  assert.ok(world.agentResult, 'Expected an agent run to have completed first');
  assert.strictEqual(world.agentResult!.rateLimited, true, `Expected the agent run to end rate-limited, got: ${JSON.stringify(world.agentResult)}`);
});
