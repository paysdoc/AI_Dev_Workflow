import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { reviewResultSchema } from '../agents/reviewAgent';
import { ReviewIssueKind, formatReviewArgs } from '../agents/reviewPromptArgs';
import { APPLICATION_TYPE_PROFILES } from '../core/applicationType';
import { FRAMEWORK_SUPPRESSION_PATTERNS } from '../core/fixRoundGuardTable';
import { getDefaultCommandsConfig, parseCommandsMd, type CommandsConfig } from '../core/projectConfig';
import { NO_PER_ISSUE_SCENARIOS, NO_SCENARIO_OPENED_A_PAGE } from '../proof/proofDocument';

/**
 * `review.md` is a prompt, so it cannot import the values ADW passes it, the application types ADW knows, the lines of the
 * scenario proof it quotes, nor the suppression patterns of the fix-round guard. These tests compare it with their sources, so
 * that a drift fails here instead of showing as a reviewer that runs a check, blocks the wrong issues or applies no guidance.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PROMPT_PATH = path.join(REPO_ROOT, '.claude/commands/review.md');
const COMMANDS_MD_PATH = path.join(REPO_ROOT, '.adw/commands.md');

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

const GATHER_CONTEXT = '## Step 1: Gather Context';
const SCOPE = '## Step 2: The Diff Does What the Issue Asks, No More and No Less';
const SUPPRESSIONS = '## Step 3: Suppressions and Weakened Checks';
const SCENARIOS = '## Step 4: The Scenarios Test the Issue';
const INDEPENDENCE = '## Step 5: Step Definition Independence Check';
const EVIDENCE = '## Step 6: The Evidence';
const GUIDELINES = '## Step 7: Coding Guidelines Check';
const TYPE_GUIDANCE = '## Step 8: Guidance for the Application Type';
const GUIDANCE_BY_TYPE = '## Guidance by application type';

const CHECK_COMMANDS = [
  'typeCheck',
  'additionalTypeChecks',
  'runLinter',
  'runBuild',
  'runTests',
  'runScenariosByTag',
  'runRegressionScenarios',
  'startDevServer',
] as const satisfies readonly (keyof CommandsConfig)[];

/** The commands a repository configures to check its code; a repository that has no such check says `N/A`. */
function checkCommandsOf(config: CommandsConfig): string[] {
  return CHECK_COMMANDS.map((key) => config[key].trim()).filter((command) => command !== '' && command !== 'N/A');
}

const OWN_CHECK_COMMANDS = checkCommandsOf(parseCommandsMd(fs.readFileSync(COMMANDS_MD_PATH, 'utf-8')));
const DEFAULT_CHECK_COMMANDS = checkCommandsOf(getDefaultCommandsConfig());

describe('review.md runs no command that checks code', () => {
  it("has the check commands of ADW's own .adw/commands.md to compare with", () => {
    expect(OWN_CHECK_COMMANDS.length).toBeGreaterThan(0);
  });

  it.each([...new Set([...OWN_CHECK_COMMANDS, ...DEFAULT_CHECK_COMMANDS])])('does not contain the check command %s', (command) => {
    expect(prompt).not.toContain(command);
  });

  it.each([
    '## Type Check',
    '## Additional Type Checks',
    '## Run Linter',
    '## Run Build',
    '## Run Tests',
    '## Run Scenarios by Tag',
    '## Run Regression Scenarios',
    '## Start Dev Server',
    '## Prepare App',
    '## Run E2E Tests',
  ])('does not refer to the .adw/commands.md heading %s', (heading) => {
    expect(prompt).not.toContain(heading);
  });

  it.each([
    /\b(?:bunx|npx|pnpm|yarn)\s/,
    /\b(?:bun|npm)\s+(?:run|test|x)\b/,
    /\btsc\b/,
    /\beslint\s/,
    /\bcucumber-js\b/,
    /\bplaywright\s+test\b/,
    /\bbddgen\b/,
    /\bvitest\b/,
    /\bjest\b/,
    /\bpytest\b/,
    /\bgo\s+(?:test|vet|build)\b/,
    /\bcargo\s+(?:test|build|check|clippy)\b/,
  ])('invokes no runner: %s', (runner) => {
    expect(prompt).not.toMatch(runner);
  });

  it('runs only read-only git commands, all of them in step 1', () => {
    const commands = [...prompt.matchAll(/`(git [^`]+)`/g)].map((match) => match[1]);

    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) expect(command).toMatch(/^git (?:remote show|branch|diff)\b/);
    for (const command of commands) expect(section(GATHER_CONTEXT)).toContain(`\`${command}\``);
  });

  it('says in its rules to run no command that checks code and never to raise a blocker about a test, lint, type or build result', () => {
    const rules = section('## Rules');

    expect(rules).toMatch(/Run no command that checks code/);
    expect(rules).toMatch(/Never raise a blocker about a test, lint, type or build result/);
  });
});

describe('review.md has no strategies and no per-repository proof file', () => {
  it('has no Strategy A or Strategy B', () => {
    expect(prompt).not.toMatch(/Strategy [AB]/);
  });

  it('names no .adw/ file but the three it reads', () => {
    const named = [...prompt.matchAll(/\.adw\/([\w-]+\.md)/g)].map((match) => match[1]);

    expect(named.length).toBeGreaterThan(0);
    for (const file of named) expect(['coding_guidelines.md', 'commands.md', 'scenarios.md']).toContain(file);
  });
});

describe('review.md takes what TypeScript knows as $0 to $6', () => {
  const context = { guidanceSection: 'Web applications', issueKind: ReviewIssueKind.Feature, imagePaths: [] };

  it('documents exactly as many arguments as ADW passes, in positions $0 to $6', () => {
    const documented = [...section('## Variables').matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    const passed = formatReviewArgs('a', 'b', 'c', undefined, context).length;

    expect(passed).toBe(7);
    expect([...new Set(documented)].sort()).toEqual(Array.from({ length: passed }, (_, position) => position));
  });

  it('documents $4 as the guidance section, $5 as the issue kind and $6 as the image paths', () => {
    const variables = section('## Variables');

    expect(variables).toMatch(/^guidanceSection: \$4/m);
    expect(variables).toMatch(/^issueKind: \$5/m);
    expect(variables).toMatch(/^perIssueImages: \$6/m);
  });
});

describe('review.md judges the scenarios by the kind of issue', () => {
  const kindLines = (): string[] => section(SCENARIOS).split('\n').filter((line) => /^\s+- `/.test(line));
  const lineFor = (kind: string): string => kindLines().find((line) => line.split(':')[0].includes(`\`${kind}\``)) ?? '';

  it.each(Object.values(ReviewIssueKind))('names the issue kind %s', (kind) => {
    expect(prompt).toContain(`\`${kind}\``);
  });

  it.each([ReviewIssueKind.Feature, ReviewIssueKind.Bug])('makes missing per-issue scenarios a blocker for a %s', (kind) => {
    expect(lineFor(kind)).toContain('`blocker`');
  });

  it.each([ReviewIssueKind.Chore, ReviewIssueKind.Promotion, ReviewIssueKind.PrReview])('makes missing per-issue scenarios no finding for a %s', (kind) => {
    expect(lineFor(kind)).toContain('no finding');
  });

  it('decides by the issue kind alone when the proof says there are no per-issue scenarios', () => {
    expect(section(SCENARIOS)).toContain(`\`${NO_PER_ISSUE_SCENARIOS}\``);
    expect(section(SCENARIOS)).toMatch(/decide by `issueKind` alone/);
  });
});

describe('review.md quotes the lines of the scenario proof that it judges', () => {
  it.each([NO_PER_ISSUE_SCENARIOS, NO_SCENARIO_OPENED_A_PAGE])('quotes "%s" verbatim', (line) => {
    expect(prompt).toContain(`\`${line}\``);
  });

  it('applies the no-page rule only to an issue that has per-issue scenarios, so that the issue kind decides alone otherwise', () => {
    const evidence = section(EVIDENCE);

    expect(evidence).toContain(`\`${NO_SCENARIO_OPENED_A_PAGE}\``);
    expect(evidence).toContain(`does not say \`${NO_PER_ISSUE_SCENARIOS}\``);
  });
});

describe('review.md has the reviewer open every image', () => {
  it('tells it in step 6 to open every image of perIssueImages with the Read tool, and to judge none it has not opened', () => {
    const evidence = section(EVIDENCE);

    expect(evidence).toContain('`perIssueImages`');
    expect(evidence).toMatch(/open every one with the Read tool/);
    expect(evidence).toMatch(/judge no image you have not opened/);
  });

  it('asks for the path of every image it opened in the screenshots of its report', () => {
    const screenshots = section('## Report').split('\n').find((line) => line.startsWith('- `screenshots`'));

    expect(screenshots).toBeDefined();
    expect(screenshots).toContain('`perIssueImages`');
  });
});

describe('review.md gives the guidance of each application type in a section of its own', () => {
  const titles = (): string[] => section(GUIDANCE_BY_TYPE).split('\n').filter((line) => line.startsWith('### ')).map((line) => line.slice(4).trim());

  it('has exactly one section for each guidance section of the mapping, and no other', () => {
    const expected = Object.values(APPLICATION_TYPE_PROFILES).map((profile) => profile.reviewGuidanceSection);

    expect([...titles()].sort()).toEqual([...expected].sort());
  });

  it('tells the reviewer in step 8 to apply the one section whose title is the guidanceSection it was given', () => {
    const step = section(TYPE_GUIDANCE);

    expect(step).toContain('`guidanceSection`');
    expect(step).toMatch(/and only that one/);
  });
});

describe('review.md blocks a suppression and a weakened check', () => {
  it('calls a suppression comment the diff adds a blocker', () => {
    expect(section(SUPPRESSIONS)).toMatch(/comment the diff adds that suppresses a check is a `blocker`/);
  });

  it.each(Object.entries(FRAMEWORK_SUPPRESSION_PATTERNS))('names a suppression of the %s language', (_language, entries) => {
    const step = section(SUPPRESSIONS);

    expect(entries.some(({ pattern }) => step.includes(pattern)), `step 3 names none of ${entries.map(({ pattern }) => pattern).join(', ')}`).toBe(true);
  });

  it('calls a change that weakens lint, compiler or build configuration a blocker, and leaves other changes to the scope check', () => {
    const step = section(SUPPRESSIONS);

    expect(step).toMatch(/lint, compiler or build configuration/);
    expect(step).toMatch(/weakens a check is a `blocker`/);
    expect(step).toMatch(/judged as in Step 2/);
  });
});

describe('review.md judges the scope of the diff', () => {
  it('blocks a requirement the diff does not meet, and a change the issue does not ask for', () => {
    const step = section(SCOPE);

    expect(step).toMatch(/requirement the diff does not meet is a `blocker`/);
    expect(step).toMatch(/change the issue does not ask for[^.]*is a `blocker`/);
  });
});

describe('review.md keeps the step-definition independence check', () => {
  it('has its heading and its four rules', () => {
    const step = section(INDEPENDENCE);

    for (const rule of ['**Observable behaviour through a public interface.**', '**The assertion can fail.**', '**Expectations come from the scenario.**', '**No accommodation.**']) {
      expect(step).toContain(rule);
    }
  });

  it('makes a violation a patch blocker, and a coding-guideline violation a refactor blocker', () => {
    expect(prompt).toMatch(/step-definition independence violation \(Step 5\), set `remediationStrategy: "patch"`/);
    expect(prompt).toMatch(/coding-guideline violation \(Step 7\), set `remediationStrategy: "refactor"`/);
    expect(section(GUIDELINES)).toContain('`remediationStrategy: "refactor"`');
  });
});

describe('review.md reports the result that the review agent parses', () => {
  it('names every field the result schema requires', () => {
    const report = section('## Report');
    const required = reviewResultSchema['required'] as string[];

    expect(required.length).toBeGreaterThan(0);
    for (const field of required) expect(report).toContain(`\`${field}\``);
  });
});
