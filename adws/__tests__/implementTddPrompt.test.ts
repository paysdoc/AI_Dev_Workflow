import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `implement-tdd/SKILL.md` is a prompt, so only its text tells the build agent which unit tests to write. These tests pin that
 * they come from the plan, that none is paired with a scenario and that the unit-test switch reads as before, so that a drift
 * fails here instead of showing as every behaviour proven twice. They also pin that the builder alone writes the step
 * definitions, with the runner rules of `step-definitions.md`. The `Scope` and `Verification` blocks the skill shares with
 * `implement.md` are compared in `buildPromptsScope.test.ts`.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SKILL_PATH = path.join(REPO_ROOT, '.claude/skills/implement-tdd/SKILL.md');
const STEP_DEFINITIONS_PATH = path.join(REPO_ROOT, '.claude/skills/implement-tdd/step-definitions.md');

const skill = fs.readFileSync(SKILL_PATH, 'utf-8');
const lines = skill.split('\n');

/** From a heading up to the next heading of the same or a higher level, or the end of the skill. */
function section(heading: string): string {
  const level = heading.match(/^#+/)?.[0].length ?? 0;
  const start = lines.findIndex((line) => line.trim() === heading);
  expect(start, `the skill has a "${heading}" section`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}} `).test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

const RED_TESTS = '### 3. Identify RED Tests';
const UNIT_TESTS = '### 5. Unit Tests (Conditional)';

const SWITCH_SENTENCE =
  'Read `.github/adw.yml`. Unit tests are disabled only when it sets `unitTests` to `false` on an uncommented line; a missing file, a missing or commented-out key, or `unitTests: true` means enabled.';
const DISABLED_LINE = '- If unit tests are **disabled**: skip unit tests entirely — only BDD scenarios drive the TDD loop.';

const FROM_THE_PLAN = [
  'Unit tests come from the plan',
  'write the unit tests the plan names, and no others',
  'no unit test of its own',
  'whether or not the issue has scenarios',
  'Real Boundary',
];

const RUNNER_RULES = ['createBdd()', 'features/steps/', 'ADW_ANDROID_SERIAL', 'ADW_IOS_UDID', 'ADW_PROOF_DIR', 'test -d node_modules || npm ci'];

function stepDefinitionsGuide(): string {
  expect(fs.existsSync(STEP_DEFINITIONS_PATH), 'the skill ships step-definitions.md').toBe(true);
  return fs.readFileSync(STEP_DEFINITIONS_PATH, 'utf-8');
}

const PAIRED_WITH_A_SCENARIO = [
  'Write the step definition AND a unit test alongside it',
  'Write step definition + unit test',
  'pass both scenario and unit test',
  'first-class part of the red-green loop for each scenario',
  'independent proof layer',
];

describe('implement-tdd takes its unit tests from the plan', () => {
  it.each(FROM_THE_PLAN)('says in step 5 "%s"', (phrase) => {
    expect(section(UNIT_TESTS)).toContain(phrase);
  });

  it.each(PAIRED_WITH_A_SCENARIO)('no longer says "%s"', (phrase) => {
    expect(skill).not.toContain(phrase);
  });

  it("writes the plan's unit tests when the issue has no scenarios", () => {
    expect(section(RED_TESTS)).toContain("the plan's unit tests (Step 5) are written either way");
  });
});

describe('implement-tdd reads the unit-test switch as before', () => {
  it.each([
    ['the switch sentence', SWITCH_SENTENCE],
    ['the line for disabled unit tests', DISABLED_LINE],
  ])('has %s in step 5, verbatim', (_name, line) => {
    expect(section(UNIT_TESTS).split('\n')).toContain(line);
  });
});

describe('implement-tdd writes every step definition the scenarios need', () => {
  it('says so in step 3', () => {
    expect(section(RED_TESTS)).toContain("You write every step definition the issue's scenarios need");
  });

  it('links step-definitions.md', () => {
    expect(skill).toContain('[step-definitions.md](step-definitions.md)');
  });

  it.each(RUNNER_RULES)('ships step-definitions.md, which names %s', (rule) => {
    expect(stepDefinitionsGuide()).toContain(rule);
  });
});
