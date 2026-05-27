/**
 * Unit tests for findOrchestratorStatePath — orchestrator directory disambiguation.
 * Covers the #529 regression where a failed init-orchestrator shadows the real
 * sdlc-orchestrator when an adwId is reused across two runs.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { findOrchestratorStatePath } from '../stateHelpers';
import { AGENTS_STATE_DIR } from '../config';

function makeAdwId(): string {
  return `test-state-helpers-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function writeState(dir: string, state: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2), 'utf-8');
}

function setupFixture(
  adwId: string,
  topLevel: Record<string, unknown>,
  subDirs: Array<{ name: string; state: Record<string, unknown> }>,
): string {
  const adwDir = path.join(AGENTS_STATE_DIR, adwId);
  writeState(adwDir, topLevel);
  for (const { name, state } of subDirs) {
    writeState(path.join(adwDir, name), state);
  }
  return adwDir;
}

describe('findOrchestratorStatePath', () => {
  const cleanupIds: string[] = [];

  afterEach(() => {
    for (const adwId of cleanupIds.splice(0)) {
      const dir = path.join(AGENTS_STATE_DIR, adwId);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('regression #529: prefers sdlc-orchestrator over a shadowing failed init-orchestrator', () => {
    const adwId = makeAdwId();
    cleanupIds.push(adwId);

    setupFixture(
      adwId,
      { orchestratorScript: 'adws/adwSdlc.tsx' },
      [
        {
          name: 'init-orchestrator',
          state: { agentName: 'init-orchestrator', execution: { status: 'failed' } },
        },
        {
          name: 'sdlc-orchestrator',
          state: { agentName: 'sdlc-orchestrator', branchName: 'feature-issue-508-x' },
        },
      ],
    );

    const result = findOrchestratorStatePath(adwId);
    expect(result?.endsWith('sdlc-orchestrator')).toBe(true);

    // Confirm branchName is readable from the resolved state
    const resolvedState = JSON.parse(
      fs.readFileSync(path.join(result!, 'state.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(resolvedState.branchName).toBe('feature-issue-508-x');
  });

  it('fallback: returns sole orchestrator dir when top-level state has no orchestratorScript', () => {
    const adwId = makeAdwId();
    cleanupIds.push(adwId);

    setupFixture(
      adwId,
      { workflowStage: 'starting' }, // no orchestratorScript
      [{ name: 'init-orchestrator', state: { agentName: 'init-orchestrator' } }],
    );

    const result = findOrchestratorStatePath(adwId);
    expect(result?.endsWith('init-orchestrator')).toBe(true);
  });

  it('fallback: returns first candidate when orchestratorScript matches nothing in the map', () => {
    const adwId = makeAdwId();
    cleanupIds.push(adwId);

    setupFixture(
      adwId,
      { orchestratorScript: 'adws/adwChore.tsx' },
      [{ name: 'sdlc-orchestrator', state: { agentName: 'sdlc-orchestrator', branchName: 'x' } }],
    );

    const result = findOrchestratorStatePath(adwId);
    expect(result?.endsWith('sdlc-orchestrator')).toBe(true);
  });

  it('single orchestrator dir (happy path unchanged)', () => {
    const adwId = makeAdwId();
    cleanupIds.push(adwId);

    setupFixture(
      adwId,
      { orchestratorScript: 'adws/adwSdlc.tsx' },
      [{ name: 'sdlc-orchestrator', state: { agentName: 'sdlc-orchestrator', branchName: 'feature-x' } }],
    );

    const result = findOrchestratorStatePath(adwId);
    expect(result?.endsWith('sdlc-orchestrator')).toBe(true);
  });

  it('returns null when no orchestrator dirs exist', () => {
    const adwId = makeAdwId();
    cleanupIds.push(adwId);

    setupFixture(
      adwId,
      { orchestratorScript: 'adws/adwSdlc.tsx' },
      [{ name: 'plan-agent', state: { agentName: 'plan-agent' } }],
    );

    const result = findOrchestratorStatePath(adwId);
    expect(result).toBeNull();
  });
});
