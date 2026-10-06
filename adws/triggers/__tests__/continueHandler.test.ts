import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  WAIVABLE_PARK_REASONS,
  buildContinueHandlerDeps,
  decideContinueAction,
  handleContinueDirective,
  type ContinueHandlerDeps,
} from '../continueHandler';
import { AgentStateManager } from '../../core/agentState';
import { isBaselineWaived } from '../../core/baselineGate';
import { log } from '../../core/logger';
import { classifyStageString } from '../../core/stageClassifier';
import { ParkReason } from '../../forge/parkComment';
import type { AgentState } from '../../types/agentTypes';

vi.mock('../../core/logger', () => ({ log: vi.fn() }));

const NOW = new Date('2026-10-04T12:00:00.000Z');

const WAIVABLE = [ParkReason.BaselineRed, ParkReason.BaseServerDown, ParkReason.PreExistingRegression];
const NOT_WAIVABLE = [ParkReason.FixLoopStalled, ParkReason.MissingApplicationType, 'a_future_park'];
const NOT_PARKED_STAGES = [
  'phase_timeout', 'paused', 'paused_auth', 'awaiting_merge', 'merge_blocked',
  'review_failed', 'build_running', 'completed', 'abandoned',
];

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    adwId: 'test-adw-id',
    issueNumber: 42,
    agentName: 'sdlc-orchestrator',
    execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
    workflowStage: 'human_gated',
    parkReason: ParkReason.BaselineRed,
    ...overrides,
  };
}

function makeDeps(state: AgentState | null = makeState()): ContinueHandlerDeps {
  return {
    readTopLevelState: vi.fn().mockReturnValue(state),
    writeTopLevelState: vi.fn(),
    now: () => NOW,
  };
}

const ADW_COMMENT = { body: '**ADW ID:** `test-adw-id`' };
const CONTINUE_COMMENT = { body: '## Continue' };

beforeEach(() => {
  vi.mocked(log).mockClear();
});

describe('WAIVABLE_PARK_REASONS', () => {
  it('holds exactly the three base-branch parks, under the values the park writes to the state', () => {
    expect([...WAIVABLE_PARK_REASONS].sort()).toEqual(['base_server_down', 'baseline_red', 'pre_existing_regression']);
  });
});

describe('decideContinueAction', () => {
  it.each(WAIVABLE)('waives the baseline for a human_gated %s park', (parkReason) => {
    expect(decideContinueAction({ workflowStage: 'human_gated', parkReason })).toEqual({ kind: 'waive_baseline', park: parkReason });
  });

  it.each(NOT_WAIVABLE)('is not a baseline park when human_gated for %s', (parkReason) => {
    expect(decideContinueAction({ workflowStage: 'human_gated', parkReason })).toEqual({ kind: 'not_a_baseline_park' });
  });

  it('is not a baseline park when human_gated without a recorded park reason', () => {
    expect(decideContinueAction({ workflowStage: 'human_gated' })).toEqual({ kind: 'not_a_baseline_park' });
  });

  it.each(NOT_PARKED_STAGES)('is not a baseline park in stage %s, whichever base-branch park reason is left in the state', (workflowStage) => {
    const actions = WAIVABLE.map((parkReason) => decideContinueAction({ workflowStage, parkReason }));

    expect(actions).toEqual(WAIVABLE.map(() => ({ kind: 'not_a_baseline_park' })));
  });

  it('is not a baseline park when the state records no stage', () => {
    expect(decideContinueAction({ parkReason: ParkReason.BaselineRed })).toEqual({ kind: 'not_a_baseline_park' });
  });

  it('is not a baseline park without a state', () => {
    expect(decideContinueAction(null)).toEqual({ kind: 'not_a_baseline_park' });
  });
});

describe('handleContinueDirective — waiver', () => {
  it.each(WAIVABLE)('records the waiver of a %s park, re-arms phase_timeout with resumeAttempts 0 and returns true', (parkReason) => {
    const deps = makeDeps(makeState({ parkReason, resumeAttempts: 3 }));

    const result = handleContinueDirective(42, [ADW_COMMENT, CONTINUE_COMMENT], deps);

    expect(result).toBe(true);
    expect(deps.writeTopLevelState).toHaveBeenCalledOnce();
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', {
      workflowStage: 'phase_timeout',
      resumeAttempts: 0,
      baseline: { status: 'waived', waivedPark: parkReason, recordedAt: '2026-10-04T12:00:00.000Z' },
    });
  });

  it('acts on the latest adw-id in the comments', () => {
    const deps = makeDeps();
    const comments = [{ body: '**ADW ID:** `older-adw-id`' }, ADW_COMMENT, CONTINUE_COMMENT];

    handleContinueDirective(42, comments, deps);

    expect(deps.readTopLevelState).toHaveBeenCalledWith('test-adw-id');
    expect(vi.mocked(deps.writeTopLevelState).mock.calls.map(([adwId]) => adwId)).toEqual(['test-adw-id']);
  });

  it('writes a stage the takeover resumes and a record the baseline gate reads as a waiver', () => {
    const deps = makeDeps();

    handleContinueDirective(42, [ADW_COMMENT], deps);

    const [, written] = vi.mocked(deps.writeTopLevelState).mock.calls[0];
    expect(classifyStageString(written.workflowStage ?? '')).toBe('resumable');
    expect(isBaselineWaived(written.baseline)).toBe(true);
  });

  it('logs the waiver as a success naming the issue, the adw-id and the park', () => {
    const deps = makeDeps(makeState({ parkReason: ParkReason.PreExistingRegression }));

    handleContinueDirective(42, [ADW_COMMENT], deps);

    const [message, level] = vi.mocked(log).mock.calls[0];
    expect(level).toBe('success');
    expect(message).toContain('#42');
    expect(message).toContain('test-adw-id');
    expect(message).toContain('pre_existing_regression');
  });
});

describe('handleContinueDirective — declines', () => {
  it('returns false without reading or writing when the comments carry no adw-id, and logs nothing', () => {
    const deps = makeDeps();

    const result = handleContinueDirective(42, [{ body: 'no adw id here' }, CONTINUE_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.readTopLevelState).not.toHaveBeenCalled();
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('returns false without writing when there are no comments', () => {
    const deps = makeDeps();

    expect(handleContinueDirective(42, [], deps)).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('returns false without writing, and logs nothing, when there is no top-level state', () => {
    const deps = makeDeps(null);

    const result = handleContinueDirective(42, [ADW_COMMENT, CONTINUE_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it.each(NOT_WAIVABLE)('returns false without writing for a human_gated %s park, and says so in one info line', (parkReason) => {
    const deps = makeDeps(makeState({ parkReason }));

    const result = handleContinueDirective(42, [ADW_COMMENT, CONTINUE_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining(parkReason), 'info');
  });

  it('returns false without writing for a human_gated state that records no park reason, and says so in one info line', () => {
    const deps = makeDeps(makeState({ parkReason: undefined }));

    const result = handleContinueDirective(42, [ADW_COMMENT, CONTINUE_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('human_gated'), 'info');
  });

  it.each(NOT_PARKED_STAGES)('returns false without writing, and logs nothing, in stage %s even with a base-branch park reason in the state', (workflowStage) => {
    for (const parkReason of WAIVABLE) {
      const deps = makeDeps(makeState({ workflowStage, parkReason }));

      expect(handleContinueDirective(42, [ADW_COMMENT, CONTINUE_COMMENT], deps)).toBe(false);
      expect(deps.writeTopLevelState).not.toHaveBeenCalled();
    }
    expect(log).not.toHaveBeenCalled();
  });

  it.each([99, null])('does not record a waiver in a state that belongs to issue %s, and warns', (issueNumber) => {
    const deps = makeDeps(makeState({ issueNumber }));

    const result = handleContinueDirective(42, [ADW_COMMENT, CONTINUE_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    const [message, level] = vi.mocked(log).mock.calls[0];
    expect(level).toBe('warn');
    expect(message).toContain('#42');
    expect(message).toContain('test-adw-id');
  });
});

describe('buildContinueHandlerDeps — over the real top-level state', () => {
  const adwId = `continue-handler-test-${Date.now()}`;

  afterEach(() => {
    fs.rmSync(path.dirname(AgentStateManager.getTopLevelStatePath(adwId)), { recursive: true, force: true });
  });

  it('turns a parked top-level state into a waived, re-armed one and leaves the rest of it as it was', () => {
    AgentStateManager.writeTopLevelState(adwId, {
      adwId,
      issueNumber: 42,
      branchName: 'feature-issue-42-test',
      workflowStage: 'human_gated',
      parkReason: ParkReason.BaselineRed,
      resumeAttempts: 2,
    });

    const result = handleContinueDirective(42, [{ body: `**ADW ID:** \`${adwId}\`` }, CONTINUE_COMMENT], buildContinueHandlerDeps());

    const state = AgentStateManager.readTopLevelState(adwId);
    expect(result).toBe(true);
    expect(state).toMatchObject({
      issueNumber: 42,
      branchName: 'feature-issue-42-test',
      workflowStage: 'phase_timeout',
      resumeAttempts: 0,
      baseline: { status: 'waived', waivedPark: 'baseline_red' },
    });
    expect(isBaselineWaived(state?.baseline)).toBe(true);
    expect(state?.baseline?.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('does not touch a top-level state that is not parked', () => {
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber: 42, workflowStage: 'phase_timeout', resumeAttempts: 2 });

    const result = handleContinueDirective(42, [{ body: `**ADW ID:** \`${adwId}\`` }, CONTINUE_COMMENT], buildContinueHandlerDeps());

    expect(result).toBe(false);
    expect(AgentStateManager.readTopLevelState(adwId)).toMatchObject({ workflowStage: 'phase_timeout', resumeAttempts: 2 });
    expect(AgentStateManager.readTopLevelState(adwId)?.baseline).toBeUndefined();
  });
});
