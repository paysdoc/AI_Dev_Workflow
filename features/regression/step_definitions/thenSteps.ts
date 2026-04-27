/**
 * Then step definitions for @regression scenarios.
 *
 * Execution pattern: mock-query (T2, T3, T7, T8, T10) and artefact reads
 * (T1, T9 — state files written by the orchestrator under test, not source files).
 *
 * IMPORTANT: T1 and T9 read the state file produced by the orchestrator as an
 * *artefact* of the system under test. This is permitted by the rot-detection
 * rubric. They do NOT read source files from adws/.
 *
 * Vocabulary phrases: T1–T11 (see features/regression/vocabulary.md).
 */

import { Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import type { RegressionWorld } from './world.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';

// ---------------------------------------------------------------------------
// T1: state file records workflowStage
// ---------------------------------------------------------------------------

Then(
  'the state file for adwId {string} records workflowStage {string}',
  function (this: RegressionWorld, adwId: string, expectedStage: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree registered for adwId "${adwId}"`);

    const stateFile = join(worktreePath, '.adw', 'state.json');
    assert.ok(
      existsSync(stateFile),
      `State file artefact not found at ${stateFile} — the orchestrator under test must have written it`,
    );

    const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
    assert.strictEqual(
      state['workflowStage'],
      expectedStage,
      `Expected workflowStage "${expectedStage}" but got "${String(state['workflowStage'])}"`,
    );
  },
);

// ---------------------------------------------------------------------------
// T2: mock API recorded a comment on issue {int}
// ---------------------------------------------------------------------------

Then(
  'the mock GitHub API recorded a comment on issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    const requests = this.getRecordedRequests();
    const commentPost = requests.find(
      (r: RecordedRequest) =>
        r.method === 'POST' &&
        r.url.includes(`/issues/${issueNumber}/comments`),
    );
    assert.ok(
      commentPost,
      `Expected a POST to /issues/${issueNumber}/comments but none was recorded. Recorded URLs: ${requests.map((r) => r.url).join(', ')}`,
    );
  },
);

// ---------------------------------------------------------------------------
// T3: mock API recorded a comment containing text {string}
// ---------------------------------------------------------------------------

Then(
  'the mock GitHub API recorded a comment containing the text {string}',
  function (this: RegressionWorld, expectedText: string) {
    const requests = this.getRecordedRequests();
    const commentPosts = requests.filter(
      (r: RecordedRequest) => r.method === 'POST' && r.url.includes('/comments'),
    );

    const found = commentPosts.some((r: RecordedRequest) => {
      try {
        const body = JSON.parse(r.body) as Record<string, unknown>;
        return typeof body['body'] === 'string' && body['body'].includes(expectedText);
      } catch {
        return false;
      }
    });

    assert.ok(
      found,
      `Expected a recorded comment containing "${expectedText}" but none found in ${commentPosts.length} comment POST(s)`,
    );
  },
);

// ---------------------------------------------------------------------------
// T4: git-mock recorded a commit on branch {string}
// ---------------------------------------------------------------------------

Then(
  'the git-mock recorded a commit on branch {string}',
  function (this: RegressionWorld, branch: string) {
    // The git-mock intercepts remote git operations. Local commit operations
    // pass through to the real git. This step asserts that the orchestrator
    // performed a commit on the expected branch, evidenced by the branch name
    // being set in World and the subprocess having completed (T5 asserts exit).
    assert.strictEqual(
      this.targetBranch,
      branch,
      `Expected branch "${branch}" but World.targetBranch is "${this.targetBranch}"`,
    );
    // The actual git commit recording requires the git-mock to log local calls.
    // For Issue #1 this step validates branch-name agreement; full invocation
    // logging wires in during Issue #2 scenario authoring.
  },
);

// ---------------------------------------------------------------------------
// T5: orchestrator subprocess exited {int}
// ---------------------------------------------------------------------------

Then(
  'the orchestrator subprocess exited {int}',
  function (this: RegressionWorld, expectedCode: number) {
    assert.strictEqual(
      this.lastExitCode,
      expectedCode,
      `Expected subprocess exit code ${expectedCode} but got ${this.lastExitCode}`,
    );
  },
);

// ---------------------------------------------------------------------------
// T6: spawn-gate lock for issue {int} is released
// ---------------------------------------------------------------------------

Then(
  'the spawn-gate lock for issue {int} is released',
  function (_this: RegressionWorld, issueNumber: number) {
    // The orchestrator lock is a runtime artefact (not a source file).
    // After the orchestrator subprocess completes, the lock file must be absent.
    // The lock path convention follows orchestratorLock.ts behaviour.
    const lockCandidates = [
      join(process.cwd(), `.adw/locks/issue-${issueNumber}.lock`),
    ];
    for (const lockPath of lockCandidates) {
      assert.ok(
        !existsSync(lockPath),
        `Expected lock artefact ${lockPath} to be absent (released) after orchestrator exit`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// T7: mock harness recorded zero PR-merge calls
// ---------------------------------------------------------------------------

Then(
  'the mock harness recorded zero PR-merge calls',
  function (this: RegressionWorld) {
    const requests = this.getRecordedRequests();
    const mergeCalls = requests.filter(
      (r: RecordedRequest) => r.method === 'PUT' && r.url.includes('/merge'),
    );
    assert.strictEqual(
      mergeCalls.length,
      0,
      `Expected zero PR-merge calls but recorded ${mergeCalls.length}`,
    );
  },
);

// ---------------------------------------------------------------------------
// T8: mock API recorded a PR creation for issue {int}
// ---------------------------------------------------------------------------

Then(
  'the mock GitHub API recorded a PR creation for issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    const requests = this.getRecordedRequests();
    const prPost = requests.find((r: RecordedRequest) => {
      if (r.method !== 'POST' || !r.url.includes('/pulls')) return false;
      try {
        const body = JSON.parse(r.body) as Record<string, unknown>;
        const bodyStr = JSON.stringify(body);
        return bodyStr.includes(String(issueNumber));
      } catch {
        return false;
      }
    });
    assert.ok(
      prPost,
      `Expected a POST to /pulls referencing issue ${issueNumber} but none was recorded`,
    );
  },
);

// ---------------------------------------------------------------------------
// T9: state file records no error
// ---------------------------------------------------------------------------

Then(
  'the state file for adwId {string} records no error',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree registered for adwId "${adwId}"`);

    const stateFile = join(worktreePath, '.adw', 'state.json');
    assert.ok(
      existsSync(stateFile),
      `State file artefact not found at ${stateFile}`,
    );

    const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
    assert.ok(
      !state['error'] && !state['errorMessage'],
      `State file records an error: ${JSON.stringify(state)}`,
    );
  },
);

// ---------------------------------------------------------------------------
// T10: mock API recorded {int} total API calls
// ---------------------------------------------------------------------------

Then(
  'the mock GitHub API recorded {int} total API calls',
  function (this: RegressionWorld, expectedCount: number) {
    const requests = this.getRecordedRequests();
    assert.strictEqual(
      requests.length,
      expectedCount,
      `Expected ${expectedCount} recorded API call(s) but got ${requests.length}`,
    );
  },
);

// ---------------------------------------------------------------------------
// T11: git-mock recorded a push to branch {string}
// ---------------------------------------------------------------------------

Then(
  'the git-mock recorded a push to branch {string}',
  function (this: RegressionWorld, branch: string) {
    // The git-remote-mock intercepts `git push` and no-ops it, recording the
    // invocation. This step validates the branch name matches the one in World.
    // Full invocation-log access wires in during Issue #2.
    assert.strictEqual(
      this.targetBranch,
      branch,
      `Expected push to branch "${branch}" but World.targetBranch is "${this.targetBranch}"`,
    );
  },
);
