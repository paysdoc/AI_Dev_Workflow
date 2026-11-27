import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `resolve_failed_scenario.md` is a prompt, so only its text tells the fix agent which `.feature` edit survives the Gherkin
 * freeze. The freeze lets a change confined to boundary tags through, so the prompt must allow exactly that and nothing more.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PROMPT_PATH = path.join(REPO_ROOT, '.claude/commands/resolve_failed_scenario.md');

const prompt = fs.readFileSync(PROMPT_PATH, 'utf-8');

/** From the frozen-contract rule up to the budget rule that follows it. */
function frozenContract(): string {
  const start = prompt.indexOf('**Frozen contract**');
  const end = prompt.indexOf('**Budget**');
  expect(start, 'the prompt has a frozen-contract rule').toBeGreaterThanOrEqual(0);
  expect(end, 'the budget rule follows the frozen-contract rule').toBeGreaterThan(start);
  return prompt.slice(start, end);
}

describe('resolve_failed_scenario.md lets the fix agent correct a boundary tag and nothing else in a .feature file', () => {
  it('keeps every .feature edit frozen except a @boundary-<name> tag when the failure is the boundary-tag check', () => {
    const rule = frozenContract();

    expect(rule).toContain('do NOT edit, add, or delete any `.feature` file');
    expect(rule).toContain('boundary-tag check');
    expect(rule).toContain("the only `.feature` edit that survives is a `@boundary-<name>` tag on a scenario's tag line");
    expect(rule).toMatch(/declared Real Boundary that the scenario's step code drives/);
    expect(rule).toContain('Every other `.feature` change is still reverted');
  });

  it('allows an entry under ## Real Boundaries only for a boundary the issue itself creates', () => {
    expect(frozenContract()).toMatch(/entry under `## Real Boundaries` in `\.adw\/scenarios\.md` only when the issue itself creates that boundary/);
  });
});
