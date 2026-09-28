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
