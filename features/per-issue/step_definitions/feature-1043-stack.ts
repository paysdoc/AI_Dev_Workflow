/**
 * What the feature-1043 tables say about a repository's stack: the four values the stack-coherence check reads, under the
 * row names the scenarios use. No hooks and no steps: any step file may import it.
 */

import assert from 'assert';
import type { DataTable } from '@cucumber/cucumber';

import type { StackCoherenceInput } from '../../../adws/core/stackCoherenceCheck.ts';

const ROWS = {
  testFramework: 'test framework',
  runTests: 'run tests',
  bddFramework: 'BDD framework',
  runScenariosByTag: 'run scenarios by tag',
} as const satisfies Readonly<Record<keyof StackCoherenceInput, string>>;

export function stackFrom(table: DataTable): StackCoherenceInput {
  const rows = table.rowsHash();
  const value = (key: keyof StackCoherenceInput): string => {
    const found = rows[ROWS[key]];
    assert.ok(found !== undefined, `Expected the table to describe the stack's "${ROWS[key]}", but it holds: ${Object.keys(rows).join(', ')}`);
    return found;
  };
  return {
    testFramework: value('testFramework'),
    runTests: value('runTests'),
    bddFramework: value('bddFramework'),
    runScenariosByTag: value('runScenariosByTag'),
  };
}
