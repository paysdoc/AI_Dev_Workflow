import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `scenario_writer.md` is a prompt, so only its text tells the scenario agent which behaviour a scenario may prove, how many
 * scenarios to write and when to write none. These tests pin those rules and the absence of the instructions they replaced, so
 * that a drift fails here instead of showing as scenarios that repeat the unit tests, or as an agent that changes the Regression
 * Suite on its own.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PROMPT_PATH = path.join(REPO_ROOT, '.claude/commands/scenario_writer.md');

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

const LAYER_RULE = '## Layer Rule';
const POLYMORPHISM = '## Polymorphism on `.adw/scenarios.md`';
const WRITE_STEP = '### 4. Write scenarios for this issue';
const OUTPUT_STEP = '### 5. Output';

const LAYER_RULES: Readonly<Record<string, readonly string[]>> = {
  'limits a scenario to behaviour observable through a Real Boundary': [
    'observable through a Real Boundary',
    'its real runtime',
    'a real browser',
    'the built artifact',
    'a real command-line invocation',
  ],
  'leaves behaviour provable inside the test process to unit tests': ['inside the test process', 'unit tests alone'],
  "names ADW's own Real Boundary": ["ADW's own repository", 'subprocess pattern', 'real child process'],
  'writes one scenario per acceptance criterion': ['one scenario per acceptance criterion'],
  'leaves variants to unit tests': ['variants, edge cases and error tables'],
  'writes no scenario and says why when the issue has no behaviour at a Real Boundary': ['write no scenario', 'state why', '`### No scenarios`'],
  'migrates no existing scenario': ['not migrated'],
};

const VOCABULARY_PREFERENCE = ['Vocabulary preference', 'prefer phrases already registered', 'features/regression/vocabulary.md'];
const REGRESSION_SWEEP = ['tag maintenance sweep', '@regression maintenance', 'Promote (add `@regression`)', 'Demote (remove `@regression`)'];

const missingFrom = (text: string, phrases: readonly string[]): string[] => phrases.filter((phrase) => !text.includes(phrase));

/** The output step up to the end of the prompt: `section` would stop at the first heading inside the fenced template. */
function outputStep(): string {
  const start = prompt.indexOf(OUTPUT_STEP);
  expect(start, `the prompt has a "${OUTPUT_STEP}" step`).toBeGreaterThanOrEqual(0);
  return prompt.slice(start);
}

describe('scenario_writer.md states the layer rule', () => {
  it.each(Object.entries(LAYER_RULES))('%s', (_rule, phrases) => {
    expect(missingFrom(section(LAYER_RULE), phrases), 'phrases the section lacks').toEqual([]);
  });
});

describe('scenario_writer.md reports the zero-scenario outcome with its reason', () => {
  it('asks under ### No scenarios why nothing of the issue is observable at a Real Boundary', () => {
    expect(outputStep()).toContain('### No scenarios');
    expect(outputStep()).toContain('Real Boundary');
  });

  it('asks for the acceptance criterion and the Real Boundary of each scenario it wrote', () => {
    expect(outputStep()).toContain('### Acceptance criteria at a Real Boundary');
  });
});

describe('scenario_writer.md no longer prefers the vocabulary', () => {
  it.each(VOCABULARY_PREFERENCE)('does not contain "%s"', (phrase) => {
    expect(prompt).not.toContain(phrase);
  });

  it('tells the agent in step 4 that a Per-Issue Scenario needs no registered phrase', () => {
    expect(section(WRITE_STEP)).toContain('needs no phrase from a vocabulary registry');
  });
});

describe('scenario_writer.md never promotes or demotes @regression itself', () => {
  it.each(REGRESSION_SWEEP)('does not contain "%s"', (phrase) => {
    expect(prompt).not.toContain(phrase);
  });

  it('branches on no section of .adw/scenarios.md for @regression', () => {
    expect(section(POLYMORPHISM)).not.toContain('@regression');
  });

  it('has five numbered steps, the last of them the output', () => {
    expect(lines.filter((line) => /^### \d+\. /.test(line))).toEqual([
      '### 1. Read configuration',
      '### 2. Parse the issue',
      '### 3. Read existing scenario files',
      WRITE_STEP,
      OUTPUT_STEP,
    ]);
  });

  it('tells the agent in step 4 never to add or remove @regression', () => {
    expect(section(WRITE_STEP)).toContain('Never add or remove `@regression`');
  });
});
