/**
 * The base branch of a feature-1049 scenario, and what the gate is handed to judge against it. The workflow's worktree is a
 * throwaway git repository: the base branch is committed to it as `dev`, with the ".adw/" the scenario describes and the
 * feature files the scenario's table says exist there, and a bare clone of it is its `origin`, so that the base checkout the
 * gate makes is a real detached worktree of `origin/dev`. No hooks and no steps: any step file may import it.
 */

import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ScenarioProofResult, TagProofResult } from '../../../adws/phases/scenarioProof.ts';

import { realGit } from '../../regression/support/fixtureWorktree.ts';
import type { Workflow929 } from '../../regression/step_definitions/feature-929-workflow.ts';
import { registerDirectory } from '../../regression/step_definitions/feature-992-world.ts';
import { writeFile } from '../../regression/step_definitions/feature-992-worktree.ts';
import type { ScenarioOutcomes } from '../../regression/step_definitions/feature-990-scripts.ts';

const REGRESSION_TAG = '@regression';
const FEATURE_FILE = 'features/cart.feature';
const IDENTITY = { authorName: 'ADW BDD', authorEmail: 'bdd@adw.invalid', committerName: 'ADW BDD', committerEmail: 'bdd@adw.invalid' };

function featureSource(scenarios: readonly ScenarioOutcomes[]): string {
  const [{ feature }] = scenarios;
  const bodies = scenarios.map(({ tag, name }) => `  ${tag}\n  Scenario: ${name}\n    Given a sample step\n`);
  return [`Feature: ${feature}`, '', ...bodies].join('\n');
}

/**
 * Commits what the worktree holds, and the scenarios the base branch has, to `branch`; a bare clone of that is `origin`. The
 * worktree then goes back to a branch of its own: the issue's.
 */
export function commitBaseBranch(workflow: Workflow929, branch: string, scenarios: readonly ScenarioOutcomes[]): void {
  const { worktreePath, config } = workflow;
  const onBase = scenarios.filter(scenario => scenario.onBaseBranch !== 'does not exist');
  if (onBase.length > 0) writeFile(worktreePath, FEATURE_FILE, featureSource(onBase));

  realGit(worktreePath, 'checkout', '-q', '-b', branch);
  realGit(worktreePath, 'add', '-A');
  realGit(worktreePath, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'The base branch');

  const originRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-1049-origin-'));
  registerDirectory(originRoot);
  const origin = path.join(originRoot, 'origin.git');
  realGit(worktreePath, 'clone', '-q', '--bare', worktreePath, origin);
  realGit(worktreePath, 'remote', 'add', 'origin', origin);
  realGit(worktreePath, 'fetch', '-q', 'origin');
  realGit(worktreePath, 'checkout', '-q', '-b', config.branchName);
}

/**
 * The launch boundary's git context addresses a repository that was never cloned. The gate makes its base checkout through the
 * git context of the workflow, so the workflow is given one for the repository its worktree is: the worktrees of a workflow
 * live under `.worktrees/` in its repository, as they do in production.
 */
export function useGitOfTheWorktree(workflow: Workflow929): void {
  const launch = workflow.config.gitContext;
  assert.ok(launch, 'Expected the workflow to carry the git context of its launch boundary');
  workflow.config.gitContext = new GitContext({
    owner: launch.owner,
    repo: launch.repo,
    selfHost: true,
    tokenProvider: createLiteralTokenProvider('bdd-1049'),
    gitIdentity: IDENTITY,
    frameworkRepoRoot: workflow.worktreePath,
    targetReposDir: workflow.worktreePath,
  });
}

function tagResultOf(tag: string, scenarios: readonly ScenarioOutcomes[]): TagProofResult {
  const failed = scenarios.some(scenario => scenario.onIssueBranch === 'fails');
  return {
    tag,
    resolvedTag: tag,
    severity: 'blocker',
    optional: false,
    passed: !failed,
    output: '',
    exitCode: failed ? 1 : 0,
    skipped: false,
    cases: scenarios.map(({ name, feature, onIssueBranch }) => ({
      name,
      classname: feature,
      status: onIssueBranch === 'fails' ? 'failed' : 'passed',
      attachments: [],
    })),
  };
}

/** The proof of the scenario test phase on the issue's branch, as the table of the scenario gives it: a result for each tag the table names, and for `@regression` whether it names one or not. */
export function proofOnIssueBranch(scenarios: readonly ScenarioOutcomes[]): ScenarioProofResult {
  const tags = [...new Set([REGRESSION_TAG, ...scenarios.map(({ tag }) => tag)])];
  const tagResults = tags.map(tag => tagResultOf(tag, scenarios.filter(scenario => scenario.tag === tag)));
  return {
    tagResults,
    hasBlockerFailures: tagResults.some(result => !result.passed),
    perIssueImages: [],
    resultsFilePath: '/proof.md',
    artifactsDir: '/artifacts',
  };
}
