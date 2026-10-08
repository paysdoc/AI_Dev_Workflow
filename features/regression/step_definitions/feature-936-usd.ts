import assert from 'assert';

/** Costs are shown with four decimals, so they are compared at that precision. */
export function assertUsd(actual: number | undefined, expected: number, what: string): void {
  assert.ok(actual !== undefined, `Expected ${what} to be $${expected.toFixed(4)}, but it is absent`);
  assert.strictEqual(actual.toFixed(4), expected.toFixed(4), `Expected ${what} to be $${expected.toFixed(4)}, got $${actual}`);
}
