import { describe, it, expect } from 'vitest';
import { parse } from '../vocabularyParser.ts';

const VALID_VOCABULARY = `
## Given — Mock Setup

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G1 | \`the mock GitHub API is configured to accept issue comments\` | Seeds mock state | mock-query | mock server state |
| G2 | \`the worktree for adwId {string} is initialised at branch {string}\` | Creates worktree | subprocess | worktree artefact |

## When — Orchestrator Invocation

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| W1 | \`the {string} orchestrator is invoked with adwId {string} and issue {int}\` | Spawns orchestrator | subprocess | exit code + state file |
| W2 | \`the plan phase is executed with config {string}\` | Imports plan phase | phase-import | state mutation |

## Then — Assertions

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| T1 | \`the state file for adwId {string} records workflowStage {string}\` | Reads state JSON | subprocess | state file artefact |

## Observability Surfaces (Examples)

- mock server state
- worktree artefact
- exit code
`;

describe('vocabularyParser.parse', () => {
  it('parses a valid vocabulary and returns phrase→entry map and surfaceExamples', () => {
    const result = parse(VALID_VOCABULARY);
    expect(result.entries.size).toBe(5);

    const g1 = result.entries.get('the mock GitHub API is configured to accept issue comments');
    expect(g1).toBeDefined();
    expect(g1?.pattern).toBe('mock-query');
    expect(g1?.assertionTarget).toBe('mock server state');

    const w1 = result.entries.get('the {string} orchestrator is invoked with adwId {string} and issue {int}');
    expect(w1).toBeDefined();
    expect(w1?.pattern).toBe('subprocess');

    expect(result.surfaceExamples).toEqual(['mock server state', 'worktree artefact', 'exit code']);
  });

  it('skips malformed rows with fewer than 5 columns without throwing', () => {
    const content = `
## Given

| # | Phrase |
|---|--------|
| G1 | short row |
`;
    const result = parse(content);
    expect(result.entries.size).toBe(0);
  });

  it('returns empty surfaceExamples when Observability Surfaces section is missing', () => {
    const content = `
## When

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| W1 | \`do something\` | Does it | subprocess | artefact |
`;
    const result = parse(content);
    expect(result.surfaceExamples).toEqual([]);
    expect(result.entries.size).toBe(1);
  });

  it('returns empty registry for empty content', () => {
    const result = parse('');
    expect(result.entries.size).toBe(0);
    expect(result.surfaceExamples).toEqual([]);
  });

  it('falls back unknown pattern to mock-query', () => {
    const content = `
## When

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| W1 | \`do something weird\` | Does it | totally-unknown-pattern | some target |
`;
    const result = parse(content);
    const entry = result.entries.get('do something weird');
    expect(entry?.pattern).toBe('mock-query');
  });

  it('strips backticks from phrase column', () => {
    const content = `
## Given

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G1 | \`the mock API is ready\` | Seeds state | mock-query | mock state |
`;
    const result = parse(content);
    expect(result.entries.has('the mock API is ready')).toBe(true);
    expect(result.entries.has('`the mock API is ready`')).toBe(false);
  });
});
