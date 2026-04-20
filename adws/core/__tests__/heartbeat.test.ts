/**
 * Contract tests for the heartbeat module.
 * Uses fake timers so no real wall-clock time is consumed.
 * Uses real AgentStateManager.writeTopLevelState for filesystem assertions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { AgentStateManager } from '../agentState';
import { AGENTS_STATE_DIR } from '../config';
import { startHeartbeat, stopHeartbeat } from '../heartbeat';

const trackedAdwIds: string[] = [];

function track(adwId: string): string {
  if (!trackedAdwIds.includes(adwId)) trackedAdwIds.push(adwId);
  return adwId;
}

function seed(adwId: string): void {
  AgentStateManager.writeTopLevelState(adwId, {});
}

function readLastSeenAt(adwId: string): string | undefined {
  const state = AgentStateManager.readTopLevelState(adwId);
  return state?.lastSeenAt;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const adwId of trackedAdwIds) {
    const dir = path.join(AGENTS_STATE_DIR, adwId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  trackedAdwIds.length = 0;
});

describe('heartbeat module contract', () => {
  it('writes lastSeenAt within intervalMs * 1.5', async () => {
    const adwId = track('hb-tick-a');
    seed(adwId);
    const handle = startHeartbeat(adwId, 100);
    await vi.advanceTimersByTimeAsync(150);
    const lastSeenAt = readLastSeenAt(adwId);
    expect(lastSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    stopHeartbeat(handle);
  });

  it('stopHeartbeat prevents subsequent writes', async () => {
    const adwId = track('hb-stop-a');
    seed(adwId);
    const handle = startHeartbeat(adwId, 100);
    await vi.advanceTimersByTimeAsync(150);
    const captured = readLastSeenAt(adwId);
    stopHeartbeat(handle);
    await vi.advanceTimersByTimeAsync(500);
    expect(readLastSeenAt(adwId)).toBe(captured);
  });

  it('stopHeartbeat is idempotent (safe to call twice)', () => {
    const adwId = track('hb-stop-b');
    seed(adwId);
    const handle = startHeartbeat(adwId, 100);
    stopHeartbeat(handle);
    expect(() => stopHeartbeat(handle)).not.toThrow();
  });

  it('tick survives a write error', async () => {
    const adwId = track('hb-err-a');
    seed(adwId);
    const spy = vi.spyOn(AgentStateManager, 'writeTopLevelState');
    spy.mockImplementationOnce(() => { throw new Error('disk full'); });
    const handle = startHeartbeat(adwId, 100);
    await vi.advanceTimersByTimeAsync(250);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    stopHeartbeat(handle);
  });
});
