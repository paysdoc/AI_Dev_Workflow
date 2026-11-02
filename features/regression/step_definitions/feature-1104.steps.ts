/**
 * The in-process scenarios of feature-1104.feature carry `@surface` and, through the feature, `@regression`, so the `@regression`
 * hooks give them the mock infrastructure and run the World's cleanup list. The hooks here are keyed on the feature's
 * `@framework-planning-commands` and on `@surface`, and install the stand-in Claude CLI (feature-1104-cli.ts) for those scenarios
 * alone. The rest are the phrases no other file defines: the framework checkout whose planning commands worktree setup copies into
 * the worktree, that copy, and the Thens that read the worktree and what the stand-in recorded of the planner's run.
 */

import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { REPO_ROOT } from '../../../adws/core/config.ts';
import { copyClaudeAssetsToWorktree, ignoreSpecsInWorktree } from '../../../adws/phases/worktreeSetup.ts';
import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import { git, initRepo, newGitContext, writeRepoFile } from '../../regression/step_definitions/feature-930-fixtures.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { commitFileOnBranch } from '../../regression/support/fixtureWorktree.ts';
import { SURFACE_REPO } from '../../regression/support/mockForgeProviders.ts';
import { readRuns, writeStandInCli, type InstalledStandIn, type StandInRun } from './feature-1104-cli.ts';
import { argumentsOf } from './feature-995-prompt.ts';

const OWN_SURFACE_SCENARIO = '@framework-planning-commands and @surface';

const PLANNING_COMMANDS: readonly string[] = ['/feature', '/bug', '/chore'];

const FRAMEWORK_ORIGIN = 'https://github.com/acme/framework.git';

interface FrameworkCheckout {
  readonly root: string;
}

interface SeededIssue {
  readonly title: string;
  readonly body: string;
}

interface State1104 {
  standIn: InstalledStandIn | undefined;
  framework: FrameworkCheckout | undefined;
  issues: Map<number, SeededIssue>;
  olderCopies: Map<string, string>;
}

function freshState(): State1104 {
  return { standIn: undefined, framework: undefined, issues: new Map(), olderCopies: new Map() };
}

const s: State1104 = freshState();

function resetState(): void {
  Object.assign(s, freshState());
}

function requireStandIn(): InstalledStandIn {
  assert.ok(s.standIn, 'Expected the Before hook of the scenario to have installed the stand-in Claude CLI');
  return s.standIn;
}

function requireFramework(): FrameworkCheckout {
  assert.ok(s.framework, 'Expected the scenario to name its framework checkout before worktree setup runs');
  return s.framework;
}

function requireWorktree(world: RegressionWorld, adwId: string): string {
  const worktreePath = world.worktreePaths.get(adwId);
  assert.ok(worktreePath, `No worktree is registered for adwId "${adwId}": G11 must initialise it first`);
  return worktreePath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `/feature` is the file `.claude/commands/feature.md`. */
export function commandFile(command: string): string {
  return `.claude/commands/${command.slice(1)}.md`;
}

function readIfPresent(file: string): string | undefined {
  return existsSync(file) ? readFileSync(file, 'utf-8') : undefined;
}

function frameworkText(command: string): string | undefined {
  return readIfPresent(join(requireFramework().root, commandFile(command)));
}

function withFrontmatter(body: string): string {
  return `---\ntarget: false\n---\n${body}\n`;
}

/** The text names its command, so no two of a checkout's commands are alike, and a copy taken from the wrong file shows in a failed comparison. */
function frameworkCommandText(command: string): string {
  return withFrontmatter(`The framework checkout's own text of the ${command} planning command.`);
}

function olderCommandText(command: string): string {
  return withFrontmatter(`An older copy of the ${command} planning command, which the branch of the target repository tracks.`);
}

Before({ tags: OWN_SURFACE_SCENARIO }, function (this: RegressionWorld) {
  resetState();
  const standIn = writeStandInCli();
  s.standIn = standIn;
  this.cleanup.push(() => rmSync(standIn.dir, { recursive: true, force: true }));
  this.claudeCliStandIn = () => standIn.scriptPath;
});

After({ tags: OWN_SURFACE_SCENARIO }, function (this: RegressionWorld) {
  this.claudeCliStandIn = undefined;
  resetState();
});

// G4 replaces the issue map with the one issue it seeds, and the phase reads that issue when it runs, so the planner is handed what is set here.
Given(
  'issue {int} in the mock issue tracker is titled {string} and its body says {string}',
  async function (this: RegressionWorld, issueNumber: number, title: string, body: string) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    const seeded = getMockServerState().issues[String(issueNumber)];
    assert.ok(isRecord(seeded), `Expected the mock issue tracker to hold issue ${issueNumber}: G4 must seed it first`);
    await this.mockContext.setState({ issues: { [String(issueNumber)]: { ...seeded, title, body } } });
    s.issues.set(issueNumber, { title, body });
  },
);

Given(
  'a framework checkout whose planning commands {string}, {string} and {string} each have text of their own',
  function (this: RegressionWorld, first: string, second: string, third: string) {
    const commands = [first, second, third];
    assert.strictEqual(new Set(commands).size, commands.length, `The planning commands of the framework checkout must be three different ones, but they are: ${commands.join(', ')}`);
    const root = mkdtempSync(join(tmpdir(), 'adw-1104-framework-'));
    this.cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    initRepo(root, 'main');
    git(root, 'remote', 'add', 'origin', FRAMEWORK_ORIGIN);
    commands.forEach((command) => writeRepoFile(root, commandFile(command), frameworkCommandText(command)));
    s.framework = { root };
  },
);

// The remote of the checked-out codebase names the ADW repository, so the copy treats the worktree of "acme/widgets" as a target repository's.
Given('the framework checkout is the checked-out ADW codebase', function () {
  s.framework = { root: REPO_ROOT };
});

Given(
  'the branch of the worktree for adwId {string} tracks an older copy of the {string} planning command',
  function (this: RegressionWorld, adwId: string, command: string) {
    const text = olderCommandText(command);
    commitFileOnBranch(requireWorktree(this, adwId), commandFile(command), text, `commands: track an older copy of the ${command} planning command`);
    s.olderCopies.set(command, text);
  },
);

/** What initializeWorkflow does to a new worktree on the --target-repo path. */
When(
  'worktree setup runs in the worktree for adwId {string} from that framework checkout',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = requireWorktree(this, adwId);
    const gitContext = newGitContext(SURFACE_REPO.owner, SURFACE_REPO.repo, dirname(worktreePath));
    copyClaudeAssetsToWorktree(worktreePath, gitContext, requireFramework().root);
    ignoreSpecsInWorktree(worktreePath);
  },
);

function describeRuns(runs: readonly StandInRun[]): string {
  return runs.length > 0 ? runs.map(({ command, cwd }) => `"${command || '(no command)'}" in ${cwd}`).join('; ') : 'nothing';
}

/** The run of the planning command, which is the only one of the workflow's agents to open with one. */
function plannerRun(world: RegressionWorld, adwId: string): StandInRun {
  const runs = readRuns(requireStandIn());
  const planners = runs.filter(({ command }) => PLANNING_COMMANDS.includes(command));
  assert.strictEqual(
    planners.length,
    1,
    `Expected the Claude CLI to have been started with exactly one planning command (${PLANNING_COMMANDS.join(', ')}), but it was started with: ${describeRuns(runs)}`,
  );
  const [run] = planners;
  const worktreePath = requireWorktree(world, adwId);
  assert.strictEqual(
    realpathSync(run.cwd),
    realpathSync(worktreePath),
    `Expected the planner to run in the worktree for adwId "${adwId}" (${worktreePath}), but it ran in ${run.cwd}`,
  );
  return run;
}

Then(
  'the worktree for adwId {string} holds the planning commands {string}, {string} and {string} as the framework checkout has them',
  function (this: RegressionWorld, adwId: string, first: string, second: string, third: string) {
    const worktreePath = requireWorktree(this, adwId);
    const differing = [first, second, third].filter((command) => readIfPresent(join(worktreePath, commandFile(command))) !== frameworkText(command));
    assert.deepStrictEqual(differing, [], `Expected the worktree to hold the framework checkout's text of each planning command, but it does not for: ${differing.join(', ')}`);
  },
);

/** Says whose text a run ran when it is not the framework checkout's command: another command's, the older copy the branch tracks, or none. */
function describeText(ran: string | undefined, command: string): string {
  if (ran === undefined) return `no text at all, for the worktree held no ${commandFile(command)} when the planner started`;
  const other = PLANNING_COMMANDS.find((candidate) => candidate !== command && ran === frameworkText(candidate));
  if (other) return `the framework checkout's text of the ${other} command`;
  if (ran === s.olderCopies.get(command)) return 'the older copy the branch tracks';
  return "a text that is neither the framework checkout's nor the older copy the branch tracks";
}

export function plannerRunOf(world: RegressionWorld, adwId: string, command: string): StandInRun {
  const run = plannerRun(world, adwId);
  assert.strictEqual(run.command, command, `Expected the planner to be started with ${command}, but it was started with ${run.command}`);
  return run;
}

Then(
  'the planner of the workflow for adwId {string} ran the {string} planning command as the framework checkout has it',
  function (this: RegressionWorld, adwId: string, command: string) {
    const run = plannerRunOf(this, adwId, command);
    const expected = frameworkText(command);
    assert.ok(expected !== undefined, `Expected the framework checkout to hold ${commandFile(command)}`);
    assert.strictEqual(run.commandText, expected, `Expected the planner to run the framework checkout's ${command} planning command, but it ran ${describeText(run.commandText, command)}`);
  },
);

function parseIssue(issueJson: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(issueJson);
  assert.ok(isRecord(parsed), `Expected the issue the planner was handed to be a JSON object, but it is: ${issueJson}`);
  return parsed;
}

Then(
  "the planner of the workflow for adwId {string} was handed the number of issue {int}, its adwId and the issue's title and body",
  function (this: RegressionWorld, adwId: string, issueNumber: number) {
    const { prompt } = plannerRun(this, adwId);
    const handed = argumentsOf(prompt);
    assert.strictEqual(handed.length, 3, `Expected the planner to be handed the issue number, the adwId and the issue, but it was handed ${handed.length} arguments: ${prompt}`);
    const [handedNumber, handedAdwId, issueJson] = handed;
    assert.strictEqual(handedNumber, String(issueNumber), `Expected the planner to be handed issue number ${issueNumber}, but it was handed ${handedNumber}`);
    assert.strictEqual(handedAdwId, adwId, `Expected the planner to be handed the adwId "${adwId}", but it was handed "${handedAdwId}"`);
    const seeded = s.issues.get(issueNumber);
    assert.ok(seeded, `Expected a Given of the scenario to have set the title and body of issue ${issueNumber}`);
    const { title, body } = parseIssue(issueJson);
    assert.deepStrictEqual({ title, body }, seeded, `Expected the issue the planner was handed to carry the title and body the scenario set for issue ${issueNumber}`);
  },
);
