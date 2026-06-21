import { describe, it, expect } from 'vitest';
import { buildContinuationPrompt, buildResumeInPlacePrompt, shouldResumeBuildInPlace, MAX_CONTINUATION_OUTPUT_LENGTH } from '../planPhase';
import type { RecoveryState } from '../../types/workflowTypes';

const PLAN = '## Plan\n\n1. Implement feature A\n2. Implement feature B';
const OUTPUT = 'previous agent partial output';

describe('buildContinuationPrompt — no checkpoint commits (first-pass behavior)', () => {
  it('plan preserved in output', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT);
    expect(result).toContain(PLAN);
  });

  it('previous output carried as continuation context', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT);
    expect(result).toContain(OUTPUT);
  });

  it('does not include authoritative git-state framing', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT);
    expect(result).not.toContain('authoritative');
  });

  it('does not include git log instructions', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT);
    expect(result).not.toContain('git log');
  });

  it('token_limit reason message', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'token_limit');
    expect(result).toContain('approached the token usage limit');
  });

  it('compaction reason message', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'compaction');
    expect(result).toContain('compacted the conversation context');
  });

  it('truncation preserved — long output sliced to last MAX_CONTINUATION_OUTPUT_LENGTH chars', () => {
    const longOutput = 'a'.repeat(MAX_CONTINUATION_OUTPUT_LENGTH + 100);
    const result = buildContinuationPrompt(PLAN, longOutput);
    const expected = longOutput.slice(-MAX_CONTINUATION_OUTPUT_LENGTH);
    expect(result).toContain(expected);
    expect(result).not.toContain('a'.repeat(MAX_CONTINUATION_OUTPUT_LENGTH + 1));
  });

  it('short output included whole', () => {
    const shortOutput = 'short output';
    const result = buildContinuationPrompt(PLAN, shortOutput);
    expect(result).toContain(shortOutput);
  });
});

describe('buildContinuationPrompt — with checkpoint commits', () => {
  it('plan preserved in output', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'token_limit', 'dev', true);
    expect(result).toContain(PLAN);
  });

  it('committed-state direction names git log against origin/dev', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'token_limit', 'dev', true);
    expect(result).toContain('git log');
    expect(result).toContain('origin/dev');
  });

  it('committed-state direction names git diff against origin/dev', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'token_limit', 'dev', true);
    expect(result).toContain('git diff');
    expect(result).toContain('origin/dev');
  });

  it('authoritative-state framing present', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'token_limit', 'dev', true);
    expect(result).toContain('authoritative');
  });

  it('uncommitted-state direction includes git status', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'token_limit', 'dev', true);
    expect(result).toContain('git status');
  });

  it('uncommitted-state direction includes git diff --staged', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'token_limit', 'dev', true);
    expect(result).toContain('git diff --staged');
  });

  it('tail retained but demoted — previous-agent-output block present with secondary note', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'token_limit', 'dev', true);
    expect(result).toContain('<previous-agent-output');
    expect(result).toContain('secondary hint only');
    expect(result).toContain(OUTPUT);
  });

  it('truncation preserved — long output sliced to last MAX_CONTINUATION_OUTPUT_LENGTH chars', () => {
    const longOutput = 'x'.repeat(MAX_CONTINUATION_OUTPUT_LENGTH + 200);
    const result = buildContinuationPrompt(PLAN, longOutput, 'token_limit', 'dev', true);
    const expected = longOutput.slice(-MAX_CONTINUATION_OUTPUT_LENGTH);
    expect(result).toContain(expected);
    expect(result).not.toContain('x'.repeat(MAX_CONTINUATION_OUTPUT_LENGTH + 1));
  });

  it('token_limit reason message', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'token_limit', 'dev', true);
    expect(result).toContain('approached the token usage limit');
  });

  it('compaction reason message', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'compaction', 'dev', true);
    expect(result).toContain('compacted the conversation context');
  });

  it('no-base fallback — git inspection guidance present without origin/undefined', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'token_limit', undefined, true);
    expect(result).toContain('git log');
    expect(result).not.toContain('origin/undefined');
  });
});

describe('buildContinuationPrompt — resumed_in_place reason', () => {
  it('plan preserved in output', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'resumed_in_place', 'dev', true);
    expect(result).toContain(PLAN);
  });

  it('reason message reflects interrupted/abandoned orchestrator', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'resumed_in_place', 'dev', true);
    expect(result).toContain('interrupted before it finished');
    expect(result).toContain('timed out or was abandoned');
    expect(result).not.toContain('approached the token usage limit');
    expect(result).not.toContain('compacted the conversation context');
  });

  it('authoritative-state framing present', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'resumed_in_place', 'dev', true);
    expect(result).toContain('authoritative');
  });

  it('committed-state direction names git log against origin/dev', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'resumed_in_place', 'dev', true);
    expect(result).toContain('git log');
    expect(result).toContain('origin/dev');
  });

  it('uncommitted-state direction includes git status and git diff --staged', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'resumed_in_place', 'dev', true);
    expect(result).toContain('git status');
    expect(result).toContain('git diff --staged');
  });

  it('"do NOT redo or revert" guidance present', () => {
    const lower = buildContinuationPrompt(PLAN, OUTPUT, 'resumed_in_place', 'dev', true).toLowerCase();
    expect(lower).toMatch(/do not redo|not redo|do not re-do/);
  });

  it('no-base fallback — git inspection guidance present without origin/undefined', () => {
    const result = buildContinuationPrompt(PLAN, OUTPUT, 'resumed_in_place', undefined, true);
    expect(result).toContain('git log');
    expect(result).not.toContain('origin/undefined');
  });
});

describe('buildResumeInPlacePrompt', () => {
  it('plan preserved in output', () => {
    const result = buildResumeInPlacePrompt(PLAN, 'dev');
    expect(result).toContain(PLAN);
  });

  it('output matches buildContinuationPrompt with resumed_in_place + checkpoints', () => {
    const result = buildResumeInPlacePrompt(PLAN, 'dev');
    const expected = buildContinuationPrompt(PLAN, '', 'resumed_in_place', 'dev', true);
    expect(result).toBe(expected);
  });

  it('authoritative framing present', () => {
    const result = buildResumeInPlacePrompt(PLAN, 'dev');
    expect(result).toContain('authoritative');
  });

  it('git inspection guidance present', () => {
    const result = buildResumeInPlacePrompt(PLAN, 'dev');
    expect(result).toContain('git log');
    expect(result).toContain('git status');
    expect(result).toContain('git diff --staged');
  });

  it('no-base fallback — no origin/undefined emitted', () => {
    const result = buildResumeInPlacePrompt(PLAN);
    expect(result).toContain('git log');
    expect(result).not.toContain('origin/undefined');
  });

  it('empty previous-output does not produce malformed previous-agent-output block', () => {
    const result = buildResumeInPlacePrompt(PLAN, 'dev');
    expect(result).toContain('<previous-agent-output');
    expect(result).not.toContain('undefined');
  });
});

describe('shouldResumeBuildInPlace', () => {
  const base: RecoveryState = {
    canResume: false,
    lastCompletedStage: null,
    adwId: null,
    branchName: null,
    planPath: null,
    prUrl: null,
  };

  it('returns true when canResume is true', () => {
    expect(shouldResumeBuildInPlace({ ...base, canResume: true })).toBe(true);
  });

  it('returns false when canResume is false', () => {
    expect(shouldResumeBuildInPlace({ ...base, canResume: false })).toBe(false);
  });
});
