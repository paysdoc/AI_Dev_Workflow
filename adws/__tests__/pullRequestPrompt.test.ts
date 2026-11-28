import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `pull_request.md` is a prompt, so only its text makes the pull request description call out a change to the target's Real
 * Boundaries, which every later scenario is checked against. These tests pin that call-out and the diff it is read from.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PROMPT_PATH = path.join(REPO_ROOT, '.claude/commands/pull_request.md');

const prompt = fs.readFileSync(PROMPT_PATH, 'utf-8');
const lines = prompt.split('\n');

/** From a heading up to the next heading of the same or a higher level, or the end of the prompt. */
function section(heading: string): string {
  const level = heading.match(/^#+/)?.[0].length ?? 0;
  const start = lines.findIndex((line) => line.trim() === heading);
  expect(start, `the prompt has a "${heading}" section`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}} `).test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** The bullet of the PR body that asks for the call-out. */
function boundaryCallOut(): string {
  const bullet = section('## Instructions')
    .split('\n')
    .find((line) => line.includes('`## Real Boundaries changed`'));
  expect(bullet, 'the instructions ask for a ## Real Boundaries changed section').toBeDefined();
  return bullet ?? '';
}

describe('pull_request.md calls out a change to the Real Boundaries list', () => {
  it('tells the agent to diff .adw/scenarios.md against the base branch', () => {
    expect(section('## Run')).toContain('`git diff origin/<defaultBranch>...HEAD -- .adw/scenarios.md`');
  });

  it('calls out a created or changed ## Real Boundaries list in a ## Real Boundaries changed section that names each boundary added or removed', () => {
    const callOut = boundaryCallOut();

    expect(callOut).toContain('`## Real Boundaries` section of `.adw/scenarios.md`');
    expect(callOut).toMatch(/whether the list was created/);
    expect(callOut).toMatch(/names every boundary added or removed, each with its entry's description/);
  });

  it('leaves that section out when the list did not change', () => {
    expect(boundaryCallOut()).toMatch(/Leave the section out when the list did not change/);
  });
});
