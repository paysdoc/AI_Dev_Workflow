import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `feature.md`, `bug.md` and `chore.md` are prompts, and all three must tell the planner the same thing about work that is not
 * meant to change what the code does. `feature.md` and `bug.md` must also state the same layer rule and read the unit-test switch
 * the same way. They cannot share one text, so these tests compare them with each other and pin the rules the shared texts carry:
 * a drift would surface only as plans without a behavioural equivalence step, as plans that leave the variants and edge cases of
 * an issue to scenarios, or as unit tests planned where the switch turns them off.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const COMMANDS = ['feature', 'bug', 'chore'] as const;
type PlanningCommand = (typeof COMMANDS)[number];

const SECTION = '## Behavioural Equivalence';
const LAYER_SECTION = '## Scenarios and Unit Tests';
const LAYER_COMMANDS = ['feature', 'bug'] as const;

const VALIDATION_PLACEHOLDER = '<if the plan has a behavioural equivalence step, list the command that runs its comparison; see Behavioural Equivalence above>';
const NOTES_PLACEHOLDER =
  '<if the issue ports, rewrites, migrates, re-bundles or restructures existing code and the plan has no behavioural equivalence step, say why; see Behavioural Equivalence above>';
const SWITCH_TASK_LINE =
  'IMPORTANT: Read `.github/adw.yml` from the current working directory. Unit tests are disabled only when that file sets `unitTests` to `false` on an uncommented line; then do NOT include any tasks for creating, writing, or running unit tests. Otherwise (no file, no `unitTests` key, a commented-out key, or `unitTests: true`) unit tests are enabled: include unit test tasks.';
const SWITCH_SECTION_LINE =
  'Read `.github/adw.yml` from the current working directory. If it sets `unitTests` to `false` on an uncommented line, OMIT this entire `### Unit Tests` subsection from the plan. Do not plan any unit test tasks or unit test file creation.';

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

const LAYER_RULES: Readonly<Record<string, readonly string[]>> = {
  'states the layer rule': [
    'observable through a Real Boundary',
    'its real runtime',
    'a real browser',
    'the built artifact',
    'a real command-line invocation',
    'inside the test process belongs to unit tests alone',
  ],
  "names ADW's own Real Boundary": ["ADW's own repository", 'subprocess pattern'],
  'has one scenario written per acceptance criterion, and none without behaviour at a Real Boundary': [
    'one scenario per acceptance criterion',
    'none when the issue has no such behaviour',
  ],
  'directs the variants and edge cases to the unit-test section': ['variants, edge cases and error cases', '`### Unit Tests`'],
  'has the build agent write only the unit tests the plan names': ['the unit tests the plan names and no others', 'no longer writes a unit test for each scenario'],
  'leaves the unit tests to the switch': ['When unit tests are disabled'],
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

describe('feature.md and bug.md carry one ## Scenarios and Unit Tests section', () => {
  it.each(LAYER_COMMANDS)('%s.md has it once, after ## Behavioural Equivalence and before ## Relevant Files and ## Plan Format', (command) => {
    const lines = linesOf(command);
    const at = lines.indexOf(LAYER_SECTION);

    expect(lines.filter((line) => line === LAYER_SECTION)).toHaveLength(1);
    expect(at).toBeGreaterThan(lines.indexOf(SECTION));
    expect(at).toBeLessThan(lines.indexOf('## Relevant Files'));
    expect(at).toBeLessThan(lines.indexOf('## Plan Format'));
  });

  it('bug.md says the same as feature.md, word for word', () => {
    expect(section(linesOf('bug'), LAYER_SECTION)).toEqual(section(linesOf('feature'), LAYER_SECTION));
  });
});

describe.each(LAYER_COMMANDS)('%s.md section ## Scenarios and Unit Tests', (command) => {
  const text = (): string => section(linesOf(command), LAYER_SECTION).join('\n');

  it.each(Object.entries(LAYER_RULES))('%s', (_rule, phrases) => {
    const missing = phrases.filter((phrase) => !text().includes(phrase));

    expect(missing, `phrases the section lacks`).toEqual([]);
  });
});

describe.each(LAYER_COMMANDS)('%s.md Plan Format reads the unit-test switch as before', (command) => {
  const planned = (heading: string): string[] => section(planFormat(linesOf(command)), heading);

  it('has the switch line under ## Step by Step Tasks', () => {
    expect(planned('## Step by Step Tasks')).toContain(SWITCH_TASK_LINE);
  });

  it('has the switch line under ### Unit Tests', () => {
    expect(planned('## Testing Strategy')).toContain(SWITCH_SECTION_LINE);
  });

  it('sends the variants, edge cases and error cases to ### Unit Tests, pointing at ## Scenarios and Unit Tests', () => {
    const strategy = planned('## Testing Strategy').join('\n');

    expect(strategy).toContain('variants, edge cases and error cases');
    expect(strategy).toContain(`\`${LAYER_SECTION}\``);
  });
});

describe('bug.md plans its unit tests as feature.md does', () => {
  it('has the ## Testing Strategy of the Plan Format of feature.md, word for word', () => {
    const strategyOf = (command: PlanningCommand): string[] => section(planFormat(linesOf(command)), '## Testing Strategy');

    expect(strategyOf('bug')).toEqual(strategyOf('feature'));
  });
});
