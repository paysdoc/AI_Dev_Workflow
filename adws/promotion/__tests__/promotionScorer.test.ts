import { describe, it, expect } from 'vitest';
import { score } from '../promotionScorer.ts';
import type { Scenario, VocabularyRegistry } from '../types.ts';

function makeRegistry(
  entries: Array<{ phrase: string; pattern: 'subprocess' | 'phase-import' | 'mock-query'; assertionTarget: string }>,
  surfaceExamples: string[] = [],
): VocabularyRegistry {
  const map = new Map(entries.map(e => [e.phrase, { phrase: e.phrase, pattern: e.pattern, assertionTarget: e.assertionTarget }]));
  return { entries: map, surfaceExamples };
}

function makeScenario(steps: Array<{ keyword: string; text: string }>): Scenario {
  return {
    tags: [],
    steps: steps.map((s, i) => ({ ...s, line: i + 1 })),
    startLine: 1,
    endLine: steps.length,
    headerLine: 1,
  };
}

describe('promotionScorer.score', () => {
  it('surface match + subprocess pattern + 1 phase = 6', () => {
    const scenario = makeScenario([
      { keyword: 'Given', text: 'the mock GitHub API is configured to accept issue comments' },
      { keyword: 'When', text: 'the "chore" orchestrator is invoked with adwId "x" and issue 1' },
      { keyword: 'Then', text: 'the state file for adwId "x" records workflowStage "done"' },
    ]);
    const reg = makeRegistry([
      { phrase: 'the mock GitHub API is configured to accept issue comments', pattern: 'mock-query', assertionTarget: 'mock server state' },
      { phrase: 'the {string} orchestrator is invoked with adwId {string} and issue {int}', pattern: 'subprocess', assertionTarget: 'exit code + state file' },
      { phrase: 'the state file for adwId {string} records workflowStage {string}', pattern: 'subprocess', assertionTarget: 'state file artefact' },
    ]);
    const exs = ['mock server state', 'exit code + state file', 'state file artefact'];
    const result = score(scenario, reg, exs);
    expect(result.total).toBe(6);
    expect(result.breakdown.surfaceMatch).toBe(3);
    expect(result.breakdown.executionPattern).toBe(3);
    expect(result.breakdown.phaseCount).toBe(0);
  });

  it('surface match + subprocess + 3 phases = 8', () => {
    const scenario = makeScenario([
      { keyword: 'Given', text: 'the mock GitHub API is configured to accept issue comments' },
      { keyword: 'When', text: 'the "chore" orchestrator is invoked with adwId "x" and issue 1' },
      { keyword: 'And', text: 'the "plan" orchestrator is invoked with adwId "x" and issue 2' },
      { keyword: 'And', text: 'the "build" orchestrator is invoked with adwId "x" and issue 3' },
      { keyword: 'Then', text: 'the state file for adwId "x" records workflowStage "done"' },
    ]);
    const reg = makeRegistry([
      { phrase: 'the mock GitHub API is configured to accept issue comments', pattern: 'mock-query', assertionTarget: 'mock server state' },
      { phrase: 'the {string} orchestrator is invoked with adwId {string} and issue {int}', pattern: 'subprocess', assertionTarget: 'exit code' },
      { phrase: 'the state file for adwId {string} records workflowStage {string}', pattern: 'subprocess', assertionTarget: 'state file' },
    ]);
    const result = score(scenario, reg, ['mock server state', 'exit code', 'state file']);
    expect(result.total).toBe(8);
    expect(result.breakdown.phaseCount).toBe(2);
  });

  it('surface match absent (unknown phrase) + subprocess = total 3', () => {
    const scenario = makeScenario([
      { keyword: 'When', text: 'the "chore" orchestrator is invoked with adwId "x" and issue 1' },
      { keyword: 'Given', text: 'some unknown phrase not in registry' },
    ]);
    const reg = makeRegistry([
      { phrase: 'the {string} orchestrator is invoked with adwId {string} and issue {int}', pattern: 'subprocess', assertionTarget: 'exit code' },
    ]);
    const result = score(scenario, reg, ['exit code']);
    // surface match = 0 because 'some unknown phrase' is unmatched (treated as absent)
    expect(result.breakdown.surfaceMatch).toBe(0);
    expect(result.breakdown.executionPattern).toBe(3);
    expect(result.total).toBe(3);
  });

  it('surface match + phase-import + 2 phases = 6', () => {
    const scenario = makeScenario([
      { keyword: 'Given', text: 'the mock GitHub API is configured to accept issue comments' },
      { keyword: 'When', text: 'the plan phase is executed with config "my-config"' },
      { keyword: 'And', text: 'the plan phase is executed with config "other-config"' },
      { keyword: 'Then', text: 'the state file for adwId "x" records workflowStage "done"' },
    ]);
    const reg = makeRegistry([
      { phrase: 'the mock GitHub API is configured to accept issue comments', pattern: 'mock-query', assertionTarget: 'mock server state' },
      { phrase: 'the plan phase is executed with config {string}', pattern: 'phase-import', assertionTarget: 'state mutation' },
      { phrase: 'the state file for adwId {string} records workflowStage {string}', pattern: 'subprocess', assertionTarget: 'state file' },
    ]);
    const result = score(scenario, reg, ['mock server state', 'state mutation', 'state file']);
    expect(result.total).toBe(6);
    expect(result.breakdown.surfaceMatch).toBe(3);
    expect(result.breakdown.executionPattern).toBe(2);
    expect(result.breakdown.phaseCount).toBe(1);
  });

  it('surface match + mock-query only + 1 phase = 3', () => {
    const scenario = makeScenario([
      { keyword: 'Given', text: 'the mock GitHub API is configured to accept issue comments' },
      { keyword: 'When', text: 'some mock-query step' },
    ]);
    const reg = makeRegistry([
      { phrase: 'the mock GitHub API is configured to accept issue comments', pattern: 'mock-query', assertionTarget: 'mock server state' },
      { phrase: 'some mock-query step', pattern: 'mock-query', assertionTarget: 'mock server state' },
    ]);
    const result = score(scenario, reg, ['mock server state']);
    expect(result.total).toBe(3);
    expect(result.breakdown.surfaceMatch).toBe(3);
    expect(result.breakdown.executionPattern).toBe(0);
  });

  it('surface match absent + mock-query only = 0', () => {
    const scenario = makeScenario([
      { keyword: 'When', text: 'some mock-query step' },
    ]);
    const reg = makeRegistry([
      { phrase: 'some mock-query step', pattern: 'mock-query', assertionTarget: 'some target' },
    ]);
    // examples do NOT include the target
    const result = score(scenario, reg, ['different target']);
    expect(result.total).toBe(0);
    expect(result.breakdown.surfaceMatch).toBe(0);
    expect(result.breakdown.executionPattern).toBe(0);
  });

  it('mixed patterns (subprocess + phase-import) → subprocess wins', () => {
    const scenario = makeScenario([
      { keyword: 'When', text: 'the "chore" orchestrator is invoked with adwId "x" and issue 1' },
      { keyword: 'And', text: 'the plan phase is executed with config "x"' },
    ]);
    const reg = makeRegistry([
      { phrase: 'the {string} orchestrator is invoked with adwId {string} and issue {int}', pattern: 'subprocess', assertionTarget: 'exit code' },
      { phrase: 'the plan phase is executed with config {string}', pattern: 'phase-import', assertionTarget: 'state mutation' },
    ]);
    const result = score(scenario, reg, ['exit code', 'state mutation']);
    expect(result.breakdown.executionPattern).toBe(3); // subprocess wins
  });

  it('scenario with zero When steps → executionPattern = 0, phaseCount = 0', () => {
    const scenario = makeScenario([
      { keyword: 'Given', text: 'the mock GitHub API is configured to accept issue comments' },
      { keyword: 'Then', text: 'the state file for adwId "x" records workflowStage "done"' },
    ]);
    const reg = makeRegistry([
      { phrase: 'the mock GitHub API is configured to accept issue comments', pattern: 'mock-query', assertionTarget: 'mock server state' },
      { phrase: 'the state file for adwId {string} records workflowStage {string}', pattern: 'subprocess', assertionTarget: 'state file' },
    ]);
    const result = score(scenario, reg, ['mock server state', 'state file']);
    expect(result.breakdown.executionPattern).toBe(0);
    expect(result.breakdown.phaseCount).toBe(0);
  });
});
