import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `feature.md`, `bug.md` and `chore.md` are prompts, and all three must tell the planner the same thing about work that is not
 * meant to change what the code does. They cannot share one text, so these tests compare them with each other and pin the rules
 * the shared section carries: a drift would surface only as plans without a behavioural equivalence step.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const COMMANDS = ['feature', 'bug', 'chore'] as const;
type PlanningCommand = (typeof COMMANDS)[number];

const SECTION = '## Behavioural Equivalence';

const VALIDATION_PLACEHOLDER = '<if the plan has a behavioural equivalence step, list the command that runs its comparison; see Behavioural Equivalence above>';
const NOTES_PLACEHOLDER =
  '<if the issue ports, rewrites, migrates, re-bundles or restructures existing code and the plan has no behavioural equivalence step, say why; see Behavioural Equivalence above>';

const RULES: Readonly<Record<string, readonly string[]>> = {
  'names what triggers the step': ['ports', 'rewrites', 'migrates', 're-bundles', 'restructures', 'stays the same'],
  'requires the step and puts it among the plan tasks': ['must include a behavioural equivalence step', '## Step by Step Tasks'],
  'says what the step contains': [
    'copy of the old implementation',
    'base branch',
    'previous released version',
    'same inputs',
    'diffs what they produce',
    'public API',
    '`null`',
    '`undefined`',
    'empty collections',
    'boundary values',
    'property-based',
  ],
  'makes the comparison a validation command': ['## Validation Commands'],
  'says which checks do not count': ['not behavioural equivalence checks', 'byte-for-byte', 'the existing tests still passing'],
  'says where a missing comparison is recorded': ['cannot be run', 'meant to change', '## Notes'],
  'does not force the step on an issue that restructures nothing': ['restructures no existing code', 'gets no behavioural equivalence step'],
};

function linesOf(command: PlanningCommand): string[] {
  return fs.readFileSync(path.join(REPO_ROOT, '.claude/commands', `${command}.md`), 'utf-8').split('\n');
}

/** From the first line equal to the heading up to the next line that starts a `## ` section, or the end of the lines. */
function section(lines: readonly string[], heading: string): string[] {
  const start = lines.indexOf(heading);
  expect(start, `has a "${heading}" section`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start, end === -1 ? undefined : end);
}

/** The lines inside the fence that holds the `Plan Format`. */
function planFormat(lines: readonly string[]): string[] {
  const open = lines.findIndex((line, index) => index > lines.indexOf('## Plan Format') && line.startsWith('```'));
  expect(open, 'has a Plan Format fence').toBeGreaterThanOrEqual(0);
  const close = lines.findIndex((line, index) => index > open && line === '```');
  expect(close, 'closes the Plan Format fence').toBeGreaterThan(open);
  return lines.slice(open + 1, close);
}

describe('the planning commands carry one ## Behavioural Equivalence section', () => {
  it.each(COMMANDS)('%s.md has it once, after ## Instructions and before ## Relevant Files and ## Plan Format', (command) => {
    const lines = linesOf(command);
    const at = lines.indexOf(SECTION);

    expect(lines.filter((line) => line === SECTION)).toHaveLength(1);
    expect(at).toBeGreaterThan(lines.indexOf('## Instructions'));
    expect(at).toBeLessThan(lines.indexOf('## Relevant Files'));
    expect(at).toBeLessThan(lines.indexOf('## Plan Format'));
  });

  it.each(['bug', 'chore'] as const)('%s.md says the same as feature.md, word for word', (command) => {
    expect(section(linesOf(command), SECTION)).toEqual(section(linesOf('feature'), SECTION));
  });
});

describe.each(COMMANDS)('%s.md section ## Behavioural Equivalence', (command) => {
  const text = (): string => section(linesOf(command), SECTION).join('\n');

  it.each(Object.entries(RULES))('%s', (_rule, phrases) => {
    const missing = phrases.filter((phrase) => !text().includes(phrase));

    expect(missing, `phrases the section lacks`).toEqual([]);
  });
});

describe.each(COMMANDS)('%s.md Plan Format points back to ## Behavioural Equivalence', (command) => {
  const planned = (heading: string): string[] => section(planFormat(linesOf(command)), heading);

  it('has the placeholder line under ## Validation Commands', () => {
    expect(planned('## Validation Commands')).toContain(VALIDATION_PLACEHOLDER);
  });

  it('has the placeholder line under ## Notes', () => {
    expect(planned('## Notes')).toContain(NOTES_PLACEHOLDER);
  });
});
