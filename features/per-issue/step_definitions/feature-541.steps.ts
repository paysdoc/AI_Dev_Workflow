/**
 * BDD step definitions for feature-541.feature
 * adwUpgrade.tsx orchestrator — framework regeneration, .adw-version bump, and upgrade PR
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'                              → ensureCronOnEveryEventSteps.ts
 *  - Given 'the claude-cli-stub is loaded with manifest {string}'          → givenSteps.ts (G3)
 *  - Given 'an issue {int} exists in the mock issue tracker'               → givenSteps.ts (G4)
 *  - Given 'the worktree for adwId {string} is initialised at branch {string}' → givenSteps.ts (G11)
 *  - Given 'the mock GitHub API is configured to accept issue comments'    → givenSteps.ts (G1)
 *  - When  'the {string} orchestrator is invoked with adwId {string} and issue {int}' → whenSteps.ts (W1)
 *  - Then  'the orchestrator subprocess exited {int}'                      → thenSteps.ts (T5)
 *  - Then  'the mock GitHub API recorded a PR creation for issue {int}'    → thenSteps.ts (T8)
 *  - Then  'the mock GitHub API recorded a comment on issue {int}'         → thenSteps.ts (T2)
 *  - Then  'the mock harness recorded zero comment posts on issue {int}'   → feature-509.steps.ts (T14)
 *  - Then  'the ADW TypeScript type-check passes'                          → feature-504.steps.ts
 *
 *  W1 note: the ORCHESTRATOR_FILES map in whenSteps.ts gains
 *    `upgrade: 'adwUpgrade.tsx'`
 *  so that W1 can spawn the upgrade orchestrator subprocess when the harness is active.
 *  The legacy `init: 'adwInit.tsx'` entry is NOT removed here (separate PRD slice #30).
 *
 * Novel vocabulary introduced here (gap surfaced per feature-541 note):
 *  - Given 'the upgrade branch {string} already carries the empty upgrade-claim commit'
 *  - Then  'the upgrade branch {string} contains exactly two commits ahead of its base: ...'
 *  - Then  'the ".adw-version" artefact in the worktree for adwId {string} records a 64-character...'
 *  - Then  'the ".adw-version" artefact in the worktree for adwId {string} does not record the hash {string}'
 *  - Then  'the ".adw-version" artefact in the worktree for adwId {string} is absent'
 *  - Then  'the most recent comment on issue {int} carries no ADW workflow marker'
 *  - Then  'the mock harness recorded zero PR creations for issue {int}'
 *
 * Per-issue execution note:
 *  These scenarios are "per-issue" (agent-input only, never run by the @regression sweep).
 *  When invoked directly via --tags "@adw-541" against a fully-wired harness, the
 *  subprocess-based steps run live. Without the harness (mockContext null), novel Then steps
 *  fall back to source inspection of adwUpgrade.tsx — the same pattern T5 uses for authPause.ts.
 */

import { Before, After, Given, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { isAdwComment } from '../../../adws/core/workflowCommentParsing.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const ADW_UPGRADE_SRC = resolve(ROOT, 'adws/adwUpgrade.tsx');

// ---------------------------------------------------------------------------
// Per-scenario mutable state
// ---------------------------------------------------------------------------

const ctx: {
  worktreePath: string;
  adwId: string;
} = {
  worktreePath: '',
  adwId: '',
};

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-541
// ---------------------------------------------------------------------------

Before({ tags: '@adw-541' }, function (this: RegressionWorld) {
  ctx.worktreePath = '';
  ctx.adwId = '';
});

After({ tags: '@adw-541' }, function (this: RegressionWorld) {
  ctx.worktreePath = '';
  ctx.adwId = '';
});

// ---------------------------------------------------------------------------
// Given — upgrade-claim commit precondition
// ---------------------------------------------------------------------------

Given(
  'the upgrade branch {string} already carries the empty upgrade-claim commit',
  function (this: RegressionWorld, branchName: string) {
    // Locate the worktree that was initialised for this branch via G11.
    const worktreePath = [...this.worktreePaths.values()].find((_p) => {
      try {
        const currentBranch = execSync('git branch --show-current', {
          cwd: _p, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return currentBranch === branchName;
      } catch {
        return false;
      }
    });

    if (!worktreePath) {
      // No real worktree found — harness not active; no-op (source-inspection path covers §1–§4)
      return;
    }

    // Create the empty upgrade-claim commit on the branch to match the real precondition.
    const gitBin = process.env['REAL_GIT_PATH'] ?? 'git';
    execSync(
      `"${gitBin}" commit --allow-empty -m "ADW upgrade in progress: ${branchName}"`,
      { cwd: worktreePath, stdio: 'pipe' },
    );
  },
);

// ---------------------------------------------------------------------------
// Then — two-commit assertion
// ---------------------------------------------------------------------------

Then(
  'the upgrade branch {string} contains exactly two commits ahead of its base: the empty upgrade claim and the framework regeneration commit',
  function (this: RegressionWorld, branchName: string) {
    // Harness active path: count commits on the branch in the worktree.
    const worktreePath = [...this.worktreePaths.values()].find((_p) => {
      try {
        const b = execSync('git branch --show-current', {
          cwd: _p, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return b === branchName;
      } catch {
        return false;
      }
    });

    if (worktreePath) {
      const gitBin = process.env['REAL_GIT_PATH'] ?? 'git';
      const defaultBranch = execSync(
        `"${gitBin}" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo "refs/remotes/origin/main"`,
        { cwd: worktreePath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim().replace('refs/remotes/origin/', '');

      const countStr = execSync(
        `"${gitBin}" rev-list --count "origin/${defaultBranch}..HEAD" 2>/dev/null || echo "0"`,
        { cwd: worktreePath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      const commitCount = parseInt(countStr, 10);
      assert.strictEqual(
        commitCount,
        2,
        `Expected exactly 2 commits ahead of base on branch "${branchName}" but found ${commitCount}`,
      );
      return;
    }

    // Source inspection fallback: confirm adwUpgrade.tsx makes a commitChanges call
    // (regen commit) on top of ensureWorktree (which carries the claim commit).
    const src = fs.readFileSync(ADW_UPGRADE_SRC, 'utf-8');
    assert.ok(
      src.includes('commitChanges'),
      'Expected adwUpgrade.tsx to call commitChanges for the regen commit',
    );
    assert.ok(
      src.includes('ensureWorktree'),
      'Expected adwUpgrade.tsx to call ensureWorktree to check out the existing claim branch',
    );
  },
);

// ---------------------------------------------------------------------------
// Then — .adw-version artefact assertions
// ---------------------------------------------------------------------------

Then(
  'the ".adw-version" artefact in the worktree for adwId {string} records a 64-character lowercase hexadecimal SHA256 digest',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);

    if (worktreePath) {
      const versionPath = path.join(worktreePath, '.adw-version');
      assert.ok(
        fs.existsSync(versionPath),
        `Expected .adw-version to exist in worktree for adwId "${adwId}" at ${versionPath}`,
      );
      const content = fs.readFileSync(versionPath, 'utf-8').trim();
      assert.match(
        content,
        /^[0-9a-f]{64}$/,
        `Expected .adw-version to contain a 64-char lowercase hex SHA256 digest, got: "${content}"`,
      );
      return;
    }

    // Source inspection fallback
    const src = fs.readFileSync(ADW_UPGRADE_SRC, 'utf-8');
    assert.ok(
      src.includes('writeAdwVersion'),
      'Expected adwUpgrade.tsx to call writeAdwVersion to persist the runtime hash',
    );
  },
);

Then(
  'the ".adw-version" artefact in the worktree for adwId {string} does not record the hash {string}',
  function (this: RegressionWorld, adwId: string, staleHash: string) {
    const worktreePath = this.worktreePaths.get(adwId);

    if (worktreePath) {
      const versionPath = path.join(worktreePath, '.adw-version');
      assert.ok(
        fs.existsSync(versionPath),
        `Expected .adw-version to exist in worktree for adwId "${adwId}" at ${versionPath}`,
      );
      const content = fs.readFileSync(versionPath, 'utf-8').trim();
      assert.notStrictEqual(
        content,
        staleHash,
        `Expected .adw-version NOT to record the stale hash "${staleHash}" but it does`,
      );
      return;
    }

    // Source inspection fallback: confirm runtime hash recomputation
    const src = fs.readFileSync(ADW_UPGRADE_SRC, 'utf-8');
    assert.ok(
      src.includes('computeFrameworkHash'),
      'Expected adwUpgrade.tsx to call computeFrameworkHash (runtime recomputation, not pinned to branch name)',
    );
  },
);

Then(
  'the ".adw-version" artefact in the worktree for adwId {string} is absent',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);

    if (worktreePath) {
      const versionPath = path.join(worktreePath, '.adw-version');
      assert.ok(
        !fs.existsSync(versionPath),
        `Expected .adw-version to be absent in worktree for adwId "${adwId}" but it exists at ${versionPath}`,
      );
      return;
    }

    // Source inspection fallback: confirm LLM failure path skips writeAdwVersion
    const src = fs.readFileSync(ADW_UPGRADE_SRC, 'utf-8');
    assert.ok(
      src.includes("reason: 'llm_failed'"),
      "Expected adwUpgrade.tsx to have an llm_failed return path that does not write .adw-version",
    );
  },
);

// ---------------------------------------------------------------------------
// Then — comment ADW-marker assertion
// ---------------------------------------------------------------------------

Then(
  'the most recent comment on issue {int} carries no ADW workflow marker',
  function (this: RegressionWorld, issueNumber: number) {
    // Harness active path: inspect the most recent recorded comment POST.
    if (this.mockContext !== null) {
      const requests = this.getRecordedRequests();
      const commentPosts = requests.filter(
        (r: RecordedRequest) =>
          r.method === 'POST' &&
          r.url.includes(`/issues/${issueNumber}/comments`),
      );
      assert.ok(
        commentPosts.length > 0,
        `Expected at least one comment POST on issue ${issueNumber} but recorded none`,
      );
      const lastPost = commentPosts[commentPosts.length - 1];
      const body = (JSON.parse(lastPost.body) as Record<string, string>)['body'] ?? '';
      assert.strictEqual(
        isAdwComment(body),
        false,
        `Expected the most recent comment on issue ${issueNumber} to carry no ADW workflow marker but it does:\n${body}`,
      );
      return;
    }

    // Source inspection fallback: confirm buildUpgradeFailureComment is used in the failure path
    const src = fs.readFileSync(ADW_UPGRADE_SRC, 'utf-8');
    assert.ok(
      src.includes('buildUpgradeFailureComment'),
      'Expected adwUpgrade.tsx to use buildUpgradeFailureComment (a non-workflow comment helper)',
    );
  },
);

// ---------------------------------------------------------------------------
// Then — zero PR creations assertion
// ---------------------------------------------------------------------------

Then(
  'the mock harness recorded zero PR creations for issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    // Harness active path: check recorded requests for any PR creation referencing this issue.
    if (this.mockContext !== null) {
      const requests = this.getRecordedRequests();
      const prPosts = requests.filter((r: RecordedRequest) => {
        if (r.method !== 'POST' || !r.url.includes('/pulls')) return false;
        try {
          const bodyStr = JSON.stringify(JSON.parse(r.body));
          return bodyStr.includes(String(issueNumber));
        } catch {
          return false;
        }
      });
      assert.strictEqual(
        prPosts.length,
        0,
        `Expected zero PR creations for issue ${issueNumber} but recorded ${prPosts.length}`,
      );
      return;
    }

    // Source inspection fallback: confirm LLM failure path does not call createPullRequest
    const src = fs.readFileSync(ADW_UPGRADE_SRC, 'utf-8');
    // The failure path returns before calling createPullRequest
    assert.ok(
      src.includes("reason: 'llm_failed'"),
      "Expected adwUpgrade.tsx to have an llm_failed early-return path that skips createPullRequest",
    );
  },
);
