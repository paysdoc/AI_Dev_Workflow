import { expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

// Shared by the review prompt tests, which read the prompt by section.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');
const PROMPT_PATH = path.join(REPO_ROOT, '.claude/commands/review.md');

export const prompt = fs.readFileSync(PROMPT_PATH, 'utf-8');
const lines = prompt.split('\n');

/** From a heading up to the next heading of the same or a higher level, or the end of the prompt. */
export function section(heading: string): string {
  const level = heading.match(/^#+/)?.[0].length ?? 0;
  const start = lines.findIndex((line) => line.trim() === heading);
  expect(start, `the prompt has a "${heading}" section`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}} `).test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

export const GATHER_CONTEXT = '## Step 1: Gather Context';
export const SCOPE = '## Step 2: The Diff Does What the Issue Asks, No More and No Less';
export const SUPPRESSIONS = '## Step 3: Suppressions and Weakened Checks';
export const SCENARIOS = '## Step 4: The Scenarios Test the Issue';
export const INDEPENDENCE = '## Step 5: Step Definition Independence Check';
export const EVIDENCE = '## Step 6: The Evidence';
export const GUIDELINES = '## Step 7: Coding Guidelines Check';
export const TYPE_GUIDANCE = '## Step 8: Guidance for the Application Type';
export const GUIDANCE_BY_TYPE = '## Guidance by application type';
