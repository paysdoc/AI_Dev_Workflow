import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findHungOrchestrators, type HungDetectorDeps } from '../hungOrchestratorDetector';
import type { AgentState } from '../../types/agentTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hung-detector-test-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function writeFixtureState(rootDir: string, adwId: string, state: Partial<AgentState>): void {
  const dir = path.join(rootDir, adwId);
  fs.mkdirSync(dir, { recursive: true });
  const full: AgentState = {
    adwId,
    issueNumber: 1,
    agentName: 'sdlc',
    execution: { status: 'running', startedAt: '2026-04-20T09:00:00.000Z' },
    workflowStage: 'build_running',
    pid: 100,
    pidStartedAt: 'token-100',
    lastSeenAt: '2026-04-20T10:00:00.000Z',
    ...state,
  } as AgentState;
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(full, null, 2));
}

function mkDeps(rootDir: string, live: Set<string>): HungDetectorDeps {
  return {
    listAdwIds: () =>
      fs.readdirSync(rootDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name),
    readTopLevelState: (id: string) => {
      try {
        const content = fs.readFileSync(path.join(rootDir, id, 'state.json'), 'utf-8');
        return JSON.parse(content) as AgentState;
      } catch {
        return null;
      }
    },
    isProcessLive: (pid: number, pidStartedAt: string) => live.has(`${pid}:${pidStartedAt}`),
  };
}

const NOW = Date.parse('2026-04-20T10:10:00.000Z');
const STALE_MS = 180_000; // 3 minutes
const STALE_LAST_SEEN = '2026-04-20T10:00:00.000Z'; // 10 min ago — stale
const FRESH_LAST_SEEN = '2026-04-20T10:09:50.000Z'; // 10 sec ago — fresh

// ---------------------------------------------------------------------------
// Positive cases
// ---------------------------------------------------------------------------

describe('findHungOrchestrators — positive cases', () => {
  it('returns build_running entry with live PID and stale lastSeenAt', () => {
    writeFixtureState(testDir, 'hung-01', {
      workflowStage: 'build_running', pid: 100, pidStartedAt: 'token-100', lastSeenAt: STALE_LAST_SEEN,
    });
    const deps = mkDeps(testDir, new Set(['100:token-100']));
    const results = findHungOrchestrators(NOW, STALE_MS, deps);
    expect(results).toHaveLength(1);
    expect(results[0].adwId).toBe('hung-01');
    expect(results[0].pid).toBe(100);
    expect(results[0].workflowStage).toBe('build_running');
  });

  it.each([
    ['test_running'],
    ['review_running'],
    ['document_running'],
    ['install_running'],
  ])('returns %s entry with live PID and stale lastSeenAt', (stage) => {
    const adwId = `hung-${stage}`;
    writeFixtureState(testDir, adwId, {
      workflowStage: stage, pid: 200, pidStartedAt: 'tok-200', lastSeenAt: STALE_LAST_SEEN,
    });
    const deps = mkDeps(testDir, new Set(['200:tok-200']));
    const results = findHungOrchestrators(NOW, STALE_MS, deps);
    expect(results.map(r => r.adwId)).toContain(adwId);
  });

  it('returns entry when lastSeenAt is exactly staleThresholdMs + 1 ms old (boundary)', () => {
    const boundary = new Date(NOW - STALE_MS - 1).toISOString();
    writeFixtureState(testDir, 'boundary-01', {
      workflowStage: 'build_running', pid: 300, pidStartedAt: 'tok-300', lastSeenAt: boundary,
    });
    const deps = mkDeps(testDir, new Set(['300:tok-300']));
    const results = findHungOrchestrators(NOW, STALE_MS, deps);
    expect(results.map(r => r.adwId)).toContain('boundary-01');
  });

  it('returns multiple hung entries across multiple adwIds', () => {
    writeFixtureState(testDir, 'multi-01', {
      workflowStage: 'build_running', pid: 401, pidStartedAt: 'tok-401', lastSeenAt: STALE_LAST_SEEN,
    });
    writeFixtureState(testDir, 'multi-02', {
      workflowStage: 'test_running', pid: 402, pidStartedAt: 'tok-402', lastSeenAt: STALE_LAST_SEEN,
    });
    const deps = mkDeps(testDir, new Set(['401:tok-401', '402:tok-402']));
    const results = findHungOrchestrators(NOW, STALE_MS, deps);
    const ids = results.map(r => r.adwId);
    expect(ids).toContain('multi-01');
    expect(ids).toContain('multi-02');
  });
});

// ---------------------------------------------------------------------------
// Negative cases
// ---------------------------------------------------------------------------

describe('findHungOrchestrators — negative cases (skipped entries)', () => {
  it('skips entry with fresh lastSeenAt (age <= threshold)', () => {
    writeFixtureState(testDir, 'fresh-01', {
      workflowStage: 'review_running', pid: 500, pidStartedAt: 'tok-500', lastSeenAt: FRESH_LAST_SEEN,
    });
    const deps = mkDeps(testDir, new Set(['500:tok-500']));
    expect(findHungOrchestrators(NOW, STALE_MS, deps)).toHaveLength(0);
  });

  it('skips entry when lastSeenAt is exactly at threshold boundary (not strictly stale)', () => {
    const exactBoundary = new Date(NOW - STALE_MS).toISOString();
    writeFixtureState(testDir, 'at-boundary', {
      workflowStage: 'build_running', pid: 501, pidStartedAt: 'tok-501', lastSeenAt: exactBoundary,
    });
    const deps = mkDeps(testDir, new Set(['501:tok-501']));
    expect(findHungOrchestrators(NOW, STALE_MS, deps)).toHaveLength(0);
  });

  it('skips entry with non-_running workflowStage (completed)', () => {
    writeFixtureState(testDir, 'terminal-01', {
      workflowStage: 'completed', pid: 600, pidStartedAt: 'tok-600', lastSeenAt: STALE_LAST_SEEN,
    });
    const deps = mkDeps(testDir, new Set(['600:tok-600']));
    expect(findHungOrchestrators(NOW, STALE_MS, deps)).toHaveLength(0);
  });

  it.each([
    ['abandoned'],
    ['discarded'],
    ['paused'],
    ['starting'],
    ['plan_building'],
    ['plan_validating'],
    ['plan_aligning'],
  ])('skips entry with workflowStage "%s"', (stage) => {
    const adwId = `skip-${stage}`;
    writeFixtureState(testDir, adwId, {
      workflowStage: stage, pid: 700, pidStartedAt: 'tok-700', lastSeenAt: STALE_LAST_SEEN,
    });
    const deps = mkDeps(testDir, new Set(['700:tok-700']));
    expect(findHungOrchestrators(NOW, STALE_MS, deps).map(r => r.adwId)).not.toContain(adwId);
  });

  it('skips entry with dead PID (not hung — already terminated)', () => {
    writeFixtureState(testDir, 'dead-pid-01', {
      workflowStage: 'build_running', pid: 800, pidStartedAt: 'tok-800', lastSeenAt: STALE_LAST_SEEN,
    });
    const deps = mkDeps(testDir, new Set()); // no live PIDs
    expect(findHungOrchestrators(NOW, STALE_MS, deps)).toHaveLength(0);
  });

  it('skips entry with undefined pid', () => {
    const dir = path.join(testDir, 'no-pid-01');
    fs.mkdirSync(dir);
    const state = {
      adwId: 'no-pid-01', issueNumber: 1, agentName: 'sdlc',
      execution: { status: 'running', startedAt: '2026-04-20T09:00:00.000Z' },
      workflowStage: 'build_running',
      pidStartedAt: 'tok-x',
      lastSeenAt: STALE_LAST_SEEN,
    };
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
    const deps = mkDeps(testDir, new Set());
    expect(() => findHungOrchestrators(NOW, STALE_MS, deps)).not.toThrow();
    expect(findHungOrchestrators(NOW, STALE_MS, deps)).toHaveLength(0);
  });

  it('skips entry with undefined pidStartedAt', () => {
    const dir = path.join(testDir, 'no-psa-01');
    fs.mkdirSync(dir);
    const state = {
      adwId: 'no-psa-01', issueNumber: 1, agentName: 'sdlc',
      execution: { status: 'running', startedAt: '2026-04-20T09:00:00.000Z' },
      workflowStage: 'build_running',
      pid: 900,
      lastSeenAt: STALE_LAST_SEEN,
    };
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
    const deps = mkDeps(testDir, new Set(['900:undefined']));
    expect(() => findHungOrchestrators(NOW, STALE_MS, deps)).not.toThrow();
    expect(findHungOrchestrators(NOW, STALE_MS, deps)).toHaveLength(0);
  });

  it('skips entry with undefined lastSeenAt', () => {
    const dir = path.join(testDir, 'no-hb-01');
    fs.mkdirSync(dir);
    const state = {
      adwId: 'no-hb-01', issueNumber: 1, agentName: 'sdlc',
      execution: { status: 'running', startedAt: '2026-04-20T09:00:00.000Z' },
      workflowStage: 'build_running',
      pid: 950, pidStartedAt: 'tok-950',
    };
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
    const deps = mkDeps(testDir, new Set(['950:tok-950']));
    expect(() => findHungOrchestrators(NOW, STALE_MS, deps)).not.toThrow();
    expect(findHungOrchestrators(NOW, STALE_MS, deps)).toHaveLength(0);
  });

  it('skips entry with unparseable lastSeenAt string', () => {
    writeFixtureState(testDir, 'bad-ts-01', {
      workflowStage: 'build_running', pid: 1000, pidStartedAt: 'tok-1000',
      lastSeenAt: 'not-a-date' as unknown as string,
    });
    const deps = mkDeps(testDir, new Set(['1000:tok-1000']));
    expect(() => findHungOrchestrators(NOW, STALE_MS, deps)).not.toThrow();
    expect(findHungOrchestrators(NOW, STALE_MS, deps)).toHaveLength(0);
  });

  it('skips malformed JSON entry and still returns valid siblings', () => {
    writeFixtureState(testDir, 'good-01', {
      workflowStage: 'build_running', pid: 1100, pidStartedAt: 'tok-1100', lastSeenAt: STALE_LAST_SEEN,
    });
    const badDir = path.join(testDir, 'bad-01');
    fs.mkdirSync(badDir);
    fs.writeFileSync(path.join(badDir, 'state.json'), '{not valid json}');
    const deps = mkDeps(testDir, new Set(['1100:tok-1100']));
    expect(() => findHungOrchestrators(NOW, STALE_MS, deps)).not.toThrow();
    const results = findHungOrchestrators(NOW, STALE_MS, deps);
    expect(results.map(r => r.adwId)).toContain('good-01');
    expect(results.map(r => r.adwId)).not.toContain('bad-01');
  });

  it('returns empty array for empty agents directory', () => {
    const deps = mkDeps(testDir, new Set());
    expect(findHungOrchestrators(NOW, STALE_MS, deps)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Injected-clock tests
// ---------------------------------------------------------------------------

describe('findHungOrchestrators — injected clock', () => {
  it('uses the passed now value, not the system clock', () => {
    const lastSeenAt = '2026-04-20T10:00:00.000Z';
    writeFixtureState(testDir, 'clock-01', {
      workflowStage: 'build_running', pid: 5005, pidStartedAt: 's-5005', lastSeenAt,
    });
    const deps = mkDeps(testDir, new Set(['5005:s-5005']));

    // 2 min after → NOT stale
    const twoMin = Date.parse('2026-04-20T10:02:00.000Z');
    expect(findHungOrchestrators(twoMin, STALE_MS, deps)).toHaveLength(0);

    // 5 min after → stale
    const fiveMin = Date.parse('2026-04-20T10:05:00.000Z');
    expect(findHungOrchestrators(fiveMin, STALE_MS, deps)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Purity assertions
// ---------------------------------------------------------------------------

describe('findHungOrchestrators — purity', () => {
  it('does not mutate any fixture state file after returning', () => {
    writeFixtureState(testDir, 'pure-01', {
      workflowStage: 'build_running', pid: 2000, pidStartedAt: 'tok-2000', lastSeenAt: STALE_LAST_SEEN,
    });
    const statePath = path.join(testDir, 'pure-01', 'state.json');
    const before = fs.readFileSync(statePath, 'utf-8');
    const deps = mkDeps(testDir, new Set(['2000:tok-2000']));
    findHungOrchestrators(NOW, STALE_MS, deps);
    const after = fs.readFileSync(statePath, 'utf-8');
    expect(after).toBe(before);
  });

  it('never calls process.kill', () => {
    writeFixtureState(testDir, 'pure-kill', {
      workflowStage: 'build_running', pid: 3000, pidStartedAt: 'tok-3000', lastSeenAt: STALE_LAST_SEEN,
    });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const deps = mkDeps(testDir, new Set(['3000:tok-3000']));
    findHungOrchestrators(NOW, STALE_MS, deps);
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });
});
