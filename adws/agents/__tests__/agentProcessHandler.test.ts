import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import type { ChildProcess } from 'child_process';

vi.mock('../../core', () => ({
  log: vi.fn(),
  AgentStateManager: {
    appendLog: vi.fn(),
    writeRawOutput: vi.fn(),
  },
  MAX_THINKING_TOKENS: 1_000_000,
  TOKEN_LIMIT_THRESHOLD: 0.9,
}));

import { handleAgentProcess } from '../agentProcessHandler';
import { INCIDENT_STREAM, INCIDENT_RESETS_AT, INCIDENT_RATE_LIMIT_TYPE } from '../../core/__tests__/fixtures/rateLimitIncident';

function createFakeChild(): { child: ChildProcess; wasKilled: () => boolean } {
  const emitter = new EventEmitter() as unknown as ChildProcess & { stdout: EventEmitter; stderr: EventEmitter };
  (emitter as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
  (emitter as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  let killed = false;
  (emitter as unknown as { kill: () => void }).kill = () => { killed = true; };
  return { child: emitter as unknown as ChildProcess, wasKilled: () => killed };
}

function tmpOutputFile(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'adw-907-handler-'));
  return path.join(dir, 'output.jsonl');
}

// Output files are intentionally not cleaned up: fs.createWriteStream inside
// handleAgentProcess opens/writes/closes asynchronously with no attached error
// listener, so removing the directory immediately after the test can race an
// in-flight write and crash the process (see feature-902.steps.ts's own note).

describe('handleAgentProcess — rate-limit facts', () => {
  it('carries rateLimitType/resetsAt from the 2026-09-22 incident stream and kills the process', async () => {
    const { child, wasKilled } = createFakeChild();
    const outputFile = tmpOutputFile();

    const resultPromise = handleAgentProcess(child, 'incident-agent', outputFile, undefined, undefined, 'haiku');

    (child.stdout as unknown as EventEmitter).emit('data', Buffer.from(INCIDENT_STREAM));
    (child as unknown as EventEmitter).emit('close', wasKilled() ? null : 0);

    const result = await resultPromise;
    expect(result.rateLimited).toBe(true);
    expect(result.rateLimitType).toBe(INCIDENT_RATE_LIMIT_TYPE);
    expect(result.resetsAt).toBe(INCIDENT_RESETS_AT);
    expect(wasKilled()).toBe(true);
  });

  it('carries no facts when only a documented api_retry signal (no rate_limit_event) ends the run rate-limited', async () => {
    const { child, wasKilled } = createFakeChild();
    const outputFile = tmpOutputFile();

    const resultPromise = handleAgentProcess(child, 'retry-agent', outputFile, undefined, undefined, 'haiku');

    const retry = JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, error: 'rate_limit', error_status: 429 });
    const errorResult = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, terminal_reason: 'api_error', result: 'rate limited' });
    (child.stdout as unknown as EventEmitter).emit('data', Buffer.from(retry + '\n' + errorResult + '\n'));
    (child as unknown as EventEmitter).emit('close', wasKilled() ? null : 0);

    const result = await resultPromise;
    expect(result.rateLimited).toBe(true);
    expect(result.rateLimitType).toBeUndefined();
    expect(result.resetsAt).toBeUndefined();
  });

  it('reports authExpired (not rateLimited) for a documented authentication_failed api_retry signal', async () => {
    const { child, wasKilled } = createFakeChild();
    const outputFile = tmpOutputFile();

    const resultPromise = handleAgentProcess(child, 'auth-agent', outputFile, undefined, undefined, 'haiku');

    const retry = JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, error: 'authentication_failed', error_status: 401 });
    (child.stdout as unknown as EventEmitter).emit('data', Buffer.from(retry + '\n'));
    (child as unknown as EventEmitter).emit('close', wasKilled() ? null : 1);

    const result = await resultPromise;
    expect(result.authExpired).toBe(true);
    expect(result.rateLimited).toBeUndefined();
  });

  it('reports authExpired for a terminal result carrying api_error_status: 401 with no api_retry line', async () => {
    const { child, wasKilled } = createFakeChild();
    const outputFile = tmpOutputFile();

    const resultPromise = handleAgentProcess(child, 'auth-result-agent', outputFile, undefined, undefined, 'haiku');

    const errorResult = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 401, terminal_reason: 'api_error', result: 'OAuth token has expired' });
    (child.stdout as unknown as EventEmitter).emit('data', Buffer.from(errorResult + '\n'));
    (child as unknown as EventEmitter).emit('close', wasKilled() ? null : 1);

    const result = await resultPromise;
    expect(result.authExpired).toBe(true);
    expect(result.rateLimited).toBeUndefined();
  });
});

describe('handleAgentProcess — cost figures', () => {
  const model = 'claude-sonnet-4-5-20250929';

  const assistantLine = JSON.stringify({
    type: 'assistant',
    message: {
      id: 'msg_1',
      model,
      usage: { input_tokens: 1000, cache_creation_input_tokens: 400, cache_read_input_tokens: 2000 },
      content: [{ type: 'text', text: 'x'.repeat(1600) }],
    },
  });

  const resultLine = JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    session_id: 's-1',
    total_cost_usd: 0.0252,
    modelUsage: {
      [model]: { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 2000, cacheCreationInputTokens: 400, costUSD: 0.0252 },
    },
  });

  async function run(lines: string[], exitCode: number) {
    const { child } = createFakeChild();
    const resultPromise = handleAgentProcess(child, 'cost-agent', tmpOutputFile(), undefined, undefined, model);
    (child.stdout as unknown as EventEmitter).emit('data', Buffer.from(lines.join('\n') + '\n'));
    (child as unknown as EventEmitter).emit('close', exitCode);
    return resultPromise;
  }

  it('keeps costUSD as the local computation and carries the CLI figure, the streamed estimate and the actual counts', async () => {
    const result = await run([assistantLine, resultLine], 0);

    const usage = result.modelUsage?.[model];
    expect(usage?.costUSD).toBeCloseTo(0.0126, 10);
    expect(usage?.reportedCostUSD).toBe(0.0252);
    expect(usage?.estimatedTokens).toEqual({ input: 1000, cache_write: 400, cache_read: 2000, output: 400 });
    expect(usage?.actualTokens).toEqual({ input: 1000, output: 500, cache_read: 2000, cache_write: 400 });
  });

  it('carries the streamed estimate but no reportedCostUSD and no actual counts when the run ends before the result message', async () => {
    const result = await run([assistantLine], 1);

    const usage = result.modelUsage?.[model];
    expect(usage?.estimatedTokens).toEqual({ input: 1000, cache_write: 400, cache_read: 2000, output: 400 });
    expect(usage).not.toHaveProperty('reportedCostUSD');
    expect(usage).not.toHaveProperty('actualTokens');
  });
});

describe('handleAgentProcess — context compaction', () => {
  const compactBoundary = JSON.stringify({ type: 'system', subtype: 'compact_boundary' }) + '\n';

  it('lets an agent run on through a compaction by default, and resolves with its final result', async () => {
    const { child, wasKilled } = createFakeChild();
    const outputFile = tmpOutputFile();
    const stdout = child.stdout as unknown as EventEmitter;

    const resultPromise = handleAgentProcess(child, 'review-agent', outputFile, undefined, undefined, 'haiku');

    stdout.emit('data', Buffer.from(compactBoundary));
    expect(wasKilled()).toBe(false);

    const draft = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'draft verdict' }] } });
    const final = JSON.stringify({ type: 'result', subtype: 'success', isError: false, result: 'final verdict', sessionId: 's1' });
    stdout.emit('data', Buffer.from(draft + '\n' + final + '\n'));
    (child as unknown as EventEmitter).emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.output).toBe('final verdict');
    expect(result.sessionId).toBe('s1');
    expect(result.compactionDetected).toBeUndefined();
  });

  it('kills an agent on compaction when its caller restarts it, and reports the run as compacted', async () => {
    const { child, wasKilled } = createFakeChild();
    const outputFile = tmpOutputFile();

    const resultPromise = handleAgentProcess(child, 'build-agent', outputFile, undefined, undefined, 'haiku', true);

    (child.stdout as unknown as EventEmitter).emit('data', Buffer.from(compactBoundary));
    expect(wasKilled()).toBe(true);
    (child as unknown as EventEmitter).emit('close', null);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.compactionDetected).toBe(true);
  });
});
