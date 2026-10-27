import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { buildContinuationPrompt, buildResumeInPlacePrompt } from '../phases/planPhase';
import { BUILD_COMPLETE_MARKER } from '../phases/progressGate';

/**
 * The prompts that build and repair code are separate files, and the continuation prompt is a string in planPhase.ts, so the
 * scope and verification rules cannot share one text. These tests compare the copies with each other and pin the rules they
 * carry: a copy that drifts would surface only as a build agent that works beyond its plan.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const COMMANDS_DIR = '.claude/commands';
const SKILL_DIR = '.claude/skills/implement-tdd';

const PLAN = '## Plan\n\n1. Implement feature A\n2. Implement feature B';
const OUTPUT = 'previous agent partial output';

const REVIEW_SCOPE_STEP = '## Step 2: The Diff Does What the Issue Asks, No More and No Less';
const DIFF_STAT = 'git diff --stat';
const STRICTER_FIX_RULE = 'Do NOT run other tests or the full test suite';
const UNCOMMITTED_EDITS =
  "Uncommitted edits outside the plan's steps are not work to continue. Do not extend them, and if one makes a validation command fail, revert it instead of repairing it.";

interface Prompt {
  readonly name: string;
  readonly lines: () => string[];
}

function linesOf(relativePath: string): string[] {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf-8').split('\n');
}

const fileOf = (name: string, relativePath: string): Prompt => ({ name, lines: () => linesOf(relativePath) });
const builtBy = (name: string, build: () => string): Prompt => ({ name, lines: () => build().split('\n') });

const IMPLEMENT = fileOf('implement.md', `${COMMANDS_DIR}/implement.md`);
const IMPLEMENT_TDD = fileOf('implement-tdd/SKILL.md', `${SKILL_DIR}/SKILL.md`);
const FIX_AGENTS = [
  fileOf('resolve_failed_scenario.md', `${COMMANDS_DIR}/resolve_failed_scenario.md`),
  fileOf('resolve_failed_test.md', `${COMMANDS_DIR}/resolve_failed_test.md`),
];
const CONTINUATIONS = [
  builtBy('continuation, checkpoint-absent', () => buildContinuationPrompt(PLAN, OUTPUT)),
  builtBy('continuation, checkpoint-present', () => buildContinuationPrompt(PLAN, OUTPUT, 'token_limit', 'dev', true)),
  builtBy('continuation, resume-in-place', () => buildResumeInPlacePrompt(PLAN, 'dev')),
];

const SCOPE_RULES: Readonly<Record<string, readonly string[]>> = {
  'limits the task to the plan': ['and nothing else'],
  'has what goes beyond the plan declared, or "none"': ['`## Beyond the plan`', '"none"'],
  'puts refactoring and the like out of scope, whatever a guideline says': ['out of scope', 'whatever a coding guideline says'],
  'leaves a pre-existing guideline violation alone unless the plan names it': ['unless the plan names it'],
};

const VERIFICATION_RULES: Readonly<Record<string, readonly string[]>> = {
  'runs the static checks and the full test suite once, at the end': ['once at the end'],
  'forbids polling with sleep': ['do not poll with `sleep`'],
  'forbids re-running a green suite': ['do not re-run a suite that is already green'],
  'forbids stress, fuzz, mutation and benchmark runs': ['stress, fuzz, mutation or benchmark runs'],
};

const headingOf = (title: string): RegExp => new RegExp(`^#{2,3} (?:\\d+\\. )?${title}$`);

const missingFrom = (text: string, phrases: readonly string[]): string[] => phrases.filter((phrase) => !text.includes(phrase));

/** The first `count` paragraphs of the lines: runs of non-blank lines, each joined with newlines. */
function firstParagraphs(lines: readonly string[], count: number): string[] {
  const start = lines.findIndex((line) => line.trim() !== '');
  if (count === 0 || start === -1) return [];
  const rest = lines.slice(start);
  const blank = rest.findIndex((line) => line.trim() === '');
  const paragraph = blank === -1 ? rest : rest.slice(0, blank);
  return [paragraph.join('\n'), ...firstParagraphs(rest.slice(paragraph.length), count - 1)];
}

/** The first `count` paragraphs under the first `##` or `###` heading titled `title`, numbered or not. */
function paragraphsAfter(lines: readonly string[], title: string, count: number): string[] {
  const heading = lines.findIndex((line) => headingOf(title).test(line));
  expect(heading, `has a "${title}" heading`).toBeGreaterThanOrEqual(0);
  return firstParagraphs(lines.slice(heading + 1), count);
}

/** From the first line equal to the heading up to the next line that starts a `## ` section, or the end of the lines. */
function section(lines: readonly string[], heading: string): string[] {
  const start = lines.indexOf(heading);
  expect(start, `has a "${heading}" section`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start, end === -1 ? undefined : end);
}

describe('the ## Scope block is one text in every prompt that builds or repairs', () => {
  const scopeOf = (prompt: Prompt): string[] => paragraphsAfter(prompt.lines(), 'Scope', 2);

  it.each([IMPLEMENT_TDD, ...FIX_AGENTS, ...CONTINUATIONS])('$name has the two paragraphs of implement.md, byte for byte', (prompt) => {
    expect(scopeOf(prompt)).toEqual(scopeOf(IMPLEMENT));
  });

  it.each(Object.entries(SCOPE_RULES))('implement.md %s', (_rule, phrases) => {
    expect(missingFrom(scopeOf(IMPLEMENT).join('\n'), phrases), 'phrases the block lacks').toEqual([]);
  });

  describe.each(CONTINUATIONS)('$name', (prompt) => {
    it('puts the scope after the completion check', () => {
      const lines = prompt.lines();

      expect(lines.indexOf('## Completion Check')).toBeGreaterThanOrEqual(0);
      expect(lines.indexOf('## Scope')).toBeGreaterThan(lines.indexOf('## Completion Check'));
    });

    it('ends the scope with the sentence on uncommitted edits', () => {
      expect(paragraphsAfter(prompt.lines(), 'Scope', 3).slice(2)).toEqual([UNCOMMITTED_EDITS]);
    });
  });
});

describe('the ## Verification block is one text in the prompts that build', () => {
  const verificationOf = (prompt: Prompt): string => paragraphsAfter(prompt.lines(), 'Verification', 1).join('\n');

  it.each([IMPLEMENT_TDD, ...CONTINUATIONS])('$name has the paragraph of implement.md, byte for byte', (prompt) => {
    expect(verificationOf(prompt)).toBe(verificationOf(IMPLEMENT));
  });

  it.each(Object.entries(VERIFICATION_RULES))('implement.md %s', (_rule, phrases) => {
    expect(missingFrom(verificationOf(IMPLEMENT), phrases), 'phrases the block lacks').toEqual([]);
  });

  it.each(FIX_AGENTS)('$name has no ## Verification block and keeps its stricter rule', (prompt) => {
    const lines = prompt.lines();

    expect(lines.filter((line) => headingOf('Verification').test(line))).toEqual([]);
    expect(lines.join('\n')).not.toContain(verificationOf(IMPLEMENT));
    expect(lines.join('\n')).toContain(STRICTER_FIX_RULE);
  });
});

describe('implement-tdd has no refactor phase', () => {
  const skillFile = (file: string): string => path.join(REPO_ROOT, SKILL_DIR, file);

  it('names neither REFACTOR nor refactoring.md', () => {
    const skill = IMPLEMENT_TDD.lines().join('\n');

    expect(skill).not.toContain('REFACTOR');
    expect(skill).not.toContain('refactoring.md');
  });

  it('no longer ships refactoring.md', () => {
    expect(fs.existsSync(skillFile('refactoring.md'))).toBe(false);
  });

  it.each(['deep-modules.md', 'interface-design.md', 'mocking.md', 'tests.md'])('still ships %s', (file) => {
    expect(fs.existsSync(skillFile(file))).toBe(true);
  });
});

describe.each(['feature', 'bug', 'chore'])('%s.md', (command) => {
  it('no longer tells the builder to refactor existing code to meet the coding guidelines', () => {
    expect(linesOf(`${COMMANDS_DIR}/${command}.md`).join('\n')).not.toContain('refactor existing code');
  });
});

describe.each([IMPLEMENT, IMPLEMENT_TDD])('the report of $name', (prompt) => {
  const report = (): string[] => section(prompt.lines(), '## Report');
  const indexOfLine = (text: string): number => report().findIndex((line) => line.includes(text));

  it('shows the completion marker on a line of its own, ahead of the diff stat', () => {
    const marker = report().findIndex((line) => line.trim() === BUILD_COMPLETE_MARKER);

    expect(marker).toBeGreaterThanOrEqual(0);
    expect(indexOfLine(DIFF_STAT), 'asks for the diff stat').toBeGreaterThanOrEqual(0);
    expect(marker).toBeLessThan(indexOfLine(DIFF_STAT));
  });

  it.each(['## Not done', '## Beyond the plan'])('names %s ahead of the diff stat', (heading) => {
    expect(indexOfLine(heading)).toBeGreaterThanOrEqual(0);
    expect(indexOfLine(heading)).toBeLessThan(indexOfLine(DIFF_STAT));
  });
});

describe('review.md', () => {
  it('has the scope step judge the items the builder declares under ## Beyond the plan', () => {
    expect(section(linesOf(`${COMMANDS_DIR}/review.md`), REVIEW_SCOPE_STEP).join('\n')).toContain('## Beyond the plan');
  });
});
