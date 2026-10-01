/**
 * §4 and §5 of feature-933: the commit each phase makes in the worktree is authored and committed by
 * the GitHub App, never by the host's own git identity.
 *
 * Each scenario runs one real phase function in-process, over a workflow built on a throwaway git
 * repository and the recording providers of `world796`, with CLAUDE_CODE_PATH pointed at a throwaway
 * script that commits with the environment it is given (see feature-933-cli.ts). The real Claude CLI is
 * never spawned and nothing reaches GitHub. Every assertion reads the commits `git log` shows on the
 * worktree's branch after the phase ran.
 */

import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import { clearClaudeCodePathCache } from '../../../adws/core/environment.ts';

import { installCli, readCliRuns, type InstalledCli } from './feature-933-cli.ts';
import { restoreEnv, snapshotScenarioEnv, withoutGitIdentityEnv, type EnvSnapshot } from './feature-933-host.ts';
import { driverFor } from './feature-933-phases.ts';
import {
  commitsSince,
  createWorkflow,
  headOf,
  makeDir,
  removeScenarioArtefacts,
  setHostIdentity,
  type AddedCommit,
  type Workflow933,
} from './feature-933-workflow.ts';

interface Scenario933 {
  workflow: Workflow933 | null;
  cli: InstalledCli | null;
  hostEnvironmentHasNoIdentity: boolean;
  headBeforePhase: string | null;
  envBeforeScenario: EnvSnapshot;
}

const s: Scenario933 = { workflow: null, cli: null, hostEnvironmentHasNoIdentity: false, headBeforePhase: null, envBeforeScenario: {} };

function resetState(): void {
  Object.assign(s, { workflow: null, cli: null, hostEnvironmentHasNoIdentity: false, headBeforePhase: null, envBeforeScenario: {} });
}

Before({ tags: '@adw-933' }, function () {
  resetState();
  s.envBeforeScenario = snapshotScenarioEnv();
});

After({ tags: '@adw-933' }, async function () {
  restoreEnv(s.envBeforeScenario);
  clearClaudeCodePathCache();
  // An agent's output stream flushes after its process closes; let it settle before its directory goes.
  await new Promise(resolve => setTimeout(resolve, 100));
  removeScenarioArtefacts();
  resetState();
});

function requireWorkflow(): Workflow933 {
  assert.ok(s.workflow, 'Expected a workflow to have been set up first');
  return s.workflow;
}

/** Without it a phase would start the real Claude CLI. */
function requireCli(): InstalledCli {
  assert.ok(s.cli, 'Expected the Claude CLI to have been replaced first: a phase would start the real one');
  return s.cli;
}

function commitsAddedByPhase(): AddedCommit[] {
  const workflow = requireWorkflow();
  assert.ok(s.headBeforePhase, 'Expected a phase to have made its commit first');
  return commitsSince(workflow.worktreePath, s.headBeforePhase);
}

function describeCommit(commit: AddedCommit): string {
  return `${commit.sha.slice(0, 7)} "${commit.subject}" authored by ${commit.authorName} <${commit.authorEmail}>, committed by ${commit.committerName} <${commit.committerEmail}>`;
}

function carriesIdentity(commit: AddedCommit, name: string, email: string): boolean {
  return commit.authorName === name && commit.authorEmail === email
    && commit.committerName === name && commit.committerEmail === email;
}

/** What the agent's CLI started with: git reads GIT_AUTHOR_* and GIT_COMMITTER_* before any configuration. */
function describeCommitRuns(): string {
  const runs = readCliRuns(requireCli()).filter(run => run.command === '/commit');
  if (runs.length === 0) return 'The Claude CLI ran no /commit.';
  return runs
    .map(run => (Object.keys(run.identityEnv).length === 0
      ? 'A /commit run started with no GIT_AUTHOR_* or GIT_COMMITTER_* variable.'
      : `A /commit run started with ${JSON.stringify(run.identityEnv)}.`))
    .join('\n');
}

Given(
  'a workflow for issue {int} in the target repository {string} that acts as the GitHub App {string} with id {int}',
  function (issueNumber: number, repoStr: string, appSlug: string, appId: number) {
    s.workflow = createWorkflow(issueNumber, repoStr, appSlug, appId);
  },
);

Given("the host's own git identity is {string} with the email {string}", function (name: string, email: string) {
  setHostIdentity(requireWorkflow(), name, email);
});

Given("no git identity is set in the host's environment", function () {
  s.hostEnvironmentHasNoIdentity = true;
});

Given("the Claude CLI commits the worktree's changes whenever it is asked to commit", function () {
  s.cli = installCli(makeDir('adw-933-cli-'));
});

When('the {} phase makes its commit', async function (phase: string) {
  const workflow = requireWorkflow();
  requireCli();
  const driver = driverFor(phase);

  const makeCommit = async (): Promise<void> => {
    driver.prepare(workflow);
    s.headBeforePhase = headOf(workflow.worktreePath);
    await driver.run(workflow);
  };
  await (s.hostEnvironmentHasNoIdentity ? withoutGitIdentityEnv(makeCommit) : makeCommit());
});

Then('the phase added a commit whose message starts with {string}', function (prefix: string) {
  const commits = commitsAddedByPhase();
  const added = commits.length === 0 ? 'no commit' : `only:\n${commits.map(describeCommit).join('\n')}`;
  assert.ok(commits.some(commit => commit.subject.startsWith(prefix)), `Expected the phase to add a commit whose message starts with "${prefix}", but it added ${added}`);
});

Then('every commit the phase added was authored and committed by {string} with the email {string}', function (name: string, email: string) {
  const commits = commitsAddedByPhase();
  assert.ok(commits.length > 0, 'Expected the phase to add a commit, but it added none');

  const wrong = commits.filter(commit => !carriesIdentity(commit, name, email));
  const report = [`Expected every commit the phase added to be authored and committed by ${name} <${email}>, but:`, ...wrong.map(describeCommit), describeCommitRuns()];
  assert.ok(wrong.length === 0, report.join('\n'));
});
