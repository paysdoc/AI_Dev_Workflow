/**
 * Unit tests for AgentStateManager top-level state operations.
 * Tests getTopLevelStatePath, writeTopLevelState, readTopLevelState,
 * and the deep-merge semantics of the phases map.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Override AGENTS_STATE_DIR before module load by setting env, then import dynamically.
// Since vitest doesn't easily allow env overrides post-import, we use the real AGENTS_STATE_DIR
// but with a unique adwId to avoid conflicts.

import { AgentStateManager } from '../agentState';
import { AGENTS_STATE_DIR } from '../config';

const TEST_ADW_ID = `test-unit-${Date.now()}`;

describe('AgentStateManager.getTopLevelStatePath()', () => {
  it('returns agents/{adwId}/state.json', () => {
    const result = AgentStateManager.getTopLevelStatePath('abc123');
    expect(result).toBe(path.join(AGENTS_STATE_DIR, 'abc123', 'state.json'));
  });

  it('returns a file path (not a directory)', () => {
    const result = AgentStateManager.getTopLevelStatePath('myid');
    expect(result).toMatch(/state\.json$/);
  });
});

describe('AgentStateManager.writeTopLevelState() and readTopLevelState()', () => {
  const adwId = TEST_ADW_ID;

  afterEach(() => {
    const dir = path.join(AGENTS_STATE_DIR, adwId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates state.json when it does not exist', () => {
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber: 1 });
    const filePath = AgentStateManager.getTopLevelStatePath(adwId);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('writes correct content to state.json', () => {
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber: 42, workflowStage: 'starting' });
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(state).not.toBeNull();
    expect(state!.adwId).toBe(adwId);
    expect(state!.issueNumber).toBe(42);
    expect(state!.workflowStage).toBe('starting');
  });

  it('creates the directory if it does not exist', () => {
    const dir = path.join(AGENTS_STATE_DIR, adwId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber: 1 });
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('merges with existing state — shallow fields overwrite', () => {
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber: 1, workflowStage: 'starting' });
    AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'build_running' });
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(state!.workflowStage).toBe('build_running');
    expect(state!.adwId).toBe(adwId);  // preserved
    expect(state!.issueNumber).toBe(1); // preserved
  });

  it('deep-merges phases — adding phase B does not clobber phase A', () => {
    AgentStateManager.writeTopLevelState(adwId, {
      phases: { install: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' } },
    });
    AgentStateManager.writeTopLevelState(adwId, {
      phases: { plan: { status: 'running', startedAt: '2024-01-01T00:01:00Z' } },
    });
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(state!.phases).not.toBeNull();
    expect(state!.phases!.install?.status).toBe('completed');
    expect(state!.phases!.plan?.status).toBe('running');
  });

  it('deep-merges individual phase entries — updates status without losing startedAt', () => {
    const startedAt = '2024-01-01T00:00:00Z';
    AgentStateManager.writeTopLevelState(adwId, {
      phases: { build: { status: 'running', startedAt } },
    });
    AgentStateManager.writeTopLevelState(adwId, {
      phases: { build: { status: 'completed', startedAt, completedAt: '2024-01-01T00:05:00Z' } },
    });
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(state!.phases!.build.status).toBe('completed');
    expect(state!.phases!.build.startedAt).toBe(startedAt);
    expect(state!.phases!.build.completedAt).toBe('2024-01-01T00:05:00Z');
  });

  it('does not clobber completed phase A when updating phase B status', () => {
    const t = '2024-01-01T00:00:00Z';
    AgentStateManager.writeTopLevelState(adwId, {
      phases: {
        install: { status: 'completed', startedAt: t, completedAt: t },
        plan: { status: 'completed', startedAt: t, completedAt: t },
      },
    });
    AgentStateManager.writeTopLevelState(adwId, {
      phases: { build: { status: 'running', startedAt: t } },
    });
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(Object.keys(state!.phases!)).toHaveLength(3);
    expect(state!.phases!.install.status).toBe('completed');
    expect(state!.phases!.plan.status).toBe('completed');
    expect(state!.phases!.build.status).toBe('running');
  });

  it('writes and reads the full new-schema top-level state (pid, pidStartedAt, lastSeenAt, branchName)', () => {
    AgentStateManager.writeTopLevelState(adwId, {
      adwId,
      pid: 4242,
      pidStartedAt: 'Sun Apr 20 10:15:23 2026',
      lastSeenAt: '2026-04-20T10:15:23.000Z',
      branchName: 'feature-issue-461-extend-top-level-state-schema',
    });
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(state!.pid).toBe(4242);
    expect(state!.pidStartedAt).toBe('Sun Apr 20 10:15:23 2026');
    expect(state!.lastSeenAt).toBe('2026-04-20T10:15:23.000Z');
    expect(state!.branchName).toBe('feature-issue-461-extend-top-level-state-schema');
  });

  it('reads a pre-461 state file missing pid/pidStartedAt/lastSeenAt/branchName without error', () => {
    const filePath = AgentStateManager.getTopLevelStatePath(adwId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ adwId, issueNumber: 1, workflowStage: 'starting' }, null, 2),
      'utf-8',
    );
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(state).not.toBeNull();
    expect(state!.adwId).toBe(adwId);
    expect(state!.workflowStage).toBe('starting');
    expect(state!.pid).toBeUndefined();
    expect(state!.pidStartedAt).toBeUndefined();
    expect(state!.lastSeenAt).toBeUndefined();
    expect(state!.branchName).toBeUndefined();
  });

  it('partial-patch write preserves unmodified new-schema fields', () => {
    AgentStateManager.writeTopLevelState(adwId, {
      adwId,
      pid: 7777,
      pidStartedAt: 'Sun Apr 20 09:00:00 2026',
      branchName: 'feature-x',
    });
    AgentStateManager.writeTopLevelState(adwId, {
      lastSeenAt: '2026-04-20T09:00:30.000Z',
    });
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(state!.pid).toBe(7777);
    expect(state!.pidStartedAt).toBe('Sun Apr 20 09:00:00 2026');
    expect(state!.branchName).toBe('feature-x');
    expect(state!.lastSeenAt).toBe('2026-04-20T09:00:30.000Z');
  });

  it('writeTopLevelState leaves no temp file behind on success', () => {
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber: 99 });
    const filePath = AgentStateManager.getTopLevelStatePath(adwId);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
  });

  it('handles corrupted state.json gracefully — starts fresh', () => {
    const filePath = AgentStateManager.getTopLevelStatePath(adwId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{ invalid json {{{{', 'utf-8');
    // Write should succeed (starts fresh)
    AgentStateManager.writeTopLevelState(adwId, { adwId, workflowStage: 'starting' });
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(state!.workflowStage).toBe('starting');
  });
});

describe('AgentStateManager.readTopLevelState()', () => {
  const adwId = `${TEST_ADW_ID}-read`;

  afterEach(() => {
    const dir = path.join(AGENTS_STATE_DIR, adwId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for non-existent file', () => {
    const result = AgentStateManager.readTopLevelState(adwId);
    expect(result).toBeNull();
  });

  it('returns parsed state for existing file', () => {
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber: 7, workflowStage: 'completed' });
    const result = AgentStateManager.readTopLevelState(adwId);
    expect(result).not.toBeNull();
    expect(result!.adwId).toBe(adwId);
    expect(result!.issueNumber).toBe(7);
    expect(result!.workflowStage).toBe('completed');
  });

  it('returns null for corrupted JSON', () => {
    const filePath = AgentStateManager.getTopLevelStatePath(adwId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'not valid json', 'utf-8');
    const result = AgentStateManager.readTopLevelState(adwId);
    expect(result).toBeNull();
  });
});

describe('Phase status transitions via writeTopLevelState', () => {
  const adwId = `${TEST_ADW_ID}-phases`;

  afterEach(() => {
    const dir = path.join(AGENTS_STATE_DIR, adwId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('running → completed transition preserves startedAt via merge', () => {
    const startedAt = '2024-06-01T10:00:00.000Z';
    AgentStateManager.writeTopLevelState(adwId, {
      phases: { build: { status: 'running', startedAt } },
    });
    AgentStateManager.writeTopLevelState(adwId, {
      phases: { build: { status: 'completed', startedAt, completedAt: '2024-06-01T10:05:00.000Z' } },
    });
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(state!.phases!.build.status).toBe('completed');
    expect(state!.phases!.build.startedAt).toBe(startedAt);
    expect(state!.phases!.build.completedAt).toBeTruthy();
  });

  it('running → failed transition records completedAt', () => {
    const startedAt = '2024-06-01T10:00:00.000Z';
    AgentStateManager.writeTopLevelState(adwId, {
      phases: { build: { status: 'running', startedAt } },
    });
    AgentStateManager.writeTopLevelState(adwId, {
      phases: { build: { status: 'failed', startedAt, completedAt: '2024-06-01T10:02:00.000Z' } },
    });
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(state!.phases!.build.status).toBe('failed');
    expect(state!.phases!.build.completedAt).toBeTruthy();
  });

  it('workflowStage updated independently of phases map', () => {
    AgentStateManager.writeTopLevelState(adwId, {
      phases: { install: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' } },
    });
    AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'testing' });
    const state = AgentStateManager.readTopLevelState(adwId);
    expect(state!.workflowStage).toBe('testing');
    expect(state!.phases!.install.status).toBe('completed'); // preserved
  });
});
