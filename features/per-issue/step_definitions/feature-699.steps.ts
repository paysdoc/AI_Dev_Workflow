/**
 * BDD step definitions for feature-699.feature
 *
 * GitContext health-check diagnostics via a self-host context —
 * the diagnostic scripts' git/gh probes route through a self-host GitContext
 * at the framework repo root, and the git/gh guard no longer exempts them.
 *
 * §1  Self-host diagnostic probes route through #run (story 5)
 * §2  Diagnostic files de-allowlisted and guard-clean (story 8)
 * §3  Whole-repo guard still passes (story 8)
 * §4  TypeScript type-check passes → feature-504.steps.ts (T22)
 *
 * Steps reused verbatim (DO NOT redefine here):
 *   feature-659.steps.ts: the process working directory is changed away from the context base path
 *                         a baseline snapshot of the parent process environment is captured
 *                         the captured command ran with auth token {string} in its child environment
 *                         the captured command ran with git author {string} in its child environment
 *                         the captured command ran with cwd equal to the context base path
 *                         the parent process environment matches the baseline snapshot
 *   feature-691.steps.ts: the git/gh guard scans the file {string}
 *                         the git/gh guard scanned that file
 *                         the git/gh guard reports no violation in that file
 *                         the git/gh guard is run across the repository
 *                         the git/gh guard reports no violations
 *   ensureCronOnEveryEventSteps.ts: the ADW codebase is checked out
 *   feature-504.steps.ts: the ADW TypeScript type-check passes
 */

import { Given, When } from '@cucumber/cucumber';
import assert from 'assert';
import { GitContext } from '../../../adws/gitContext/index.ts';
import {
  W,
  makeSpyExec,
  makeNoOpFsDeps,
  parseAuthor,
  TARGET_REPOS_ROOT,
} from './gitContextSharedWorld.ts';

// ── Self-host construction with recording runner ──────────────────────────────

Given(
  'a self-host GitContext for owner {string} repo {string} with auth token {string} and git author {string} and framework root {string} whose git and gh commands are captured by a recording runner',
  function (owner: string, repo: string, token: string, authorStr: string, frameworkRoot: string) {
    const { name, email } = parseAuthor(authorStr);
    const { exec, calls } = makeSpyExec(W.responseMap);
    W.ctx = new GitContext(
      {
        owner,
        repo,
        selfHost: true,
        token,
        gitIdentity: {
          authorName: name,
          authorEmail: email,
          committerName: name,
          committerEmail: email,
        },
        frameworkRepoRoot: frameworkRoot,
        targetReposDir: TARGET_REPOS_ROOT,
      },
      { exec, fsDeps: makeNoOpFsDeps() },
    );
    W.spyCalls = calls;
  },
);

// ── Self-host probe dispatcher ────────────────────────────────────────────────

When('the {string} self-host probe runs through the context', function (probeName: string) {
  assert.ok(W.ctx !== null, 'Expected a self-host GitContext to be set up with a recording runner');

  switch (probeName) {
    case 'current-branch':
      // getCurrentBranch routes through #run with git branch --show-current
      W.responseMap.set('branch --show-current', 'main\n');
      W.ctx.getCurrentBranch();
      break;
    case 'gh-auth':
      // authenticatedUser routes through #run with gh api user
      W.responseMap.set('api user', '{"login":"bot","id":1}\n');
      W.ctx.authenticatedUser();
      break;
    case 'gh-issue-view':
      // fetchIssue routes through #run with gh issue view --repo --json
      W.responseMap.set('issue view', '{"number":1,"title":"x","state":"OPEN","body":"","author":{"login":"bot"},"assignees":[],"labels":[],"createdAt":"2024-01-01T00:00:00Z","updatedAt":"2024-01-01T00:00:00Z"}\n');
      W.ctx.fetchIssue(1);
      break;
    default:
      throw new Error(`Unknown self-host probe: "${probeName}"`);
  }
});
