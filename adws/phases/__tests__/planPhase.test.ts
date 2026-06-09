import { describe, it, expect } from 'vitest';
import { buildContinuationPrompt, MAX_CONTINUATION_OUTPUT_LENGTH } from '../planPhase';

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
