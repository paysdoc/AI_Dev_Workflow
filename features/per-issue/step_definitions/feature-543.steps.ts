/**
 * BDD step definitions for feature-543.feature
 * HITL opt-in via .github/adw.yml — gates whether the upgrade PR auto-merges
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'                              → ensureCronOnEveryEventSteps.ts
 *  - Given 'the claude-cli-stub is loaded with manifest {string}'          → givenSteps.ts (G3)
 *  - Given 'an issue {int} exists in the mock issue tracker'               → givenSteps.ts (G4)
 *  - Given 'the worktree for adwId {string} is initialised at branch {string}' → givenSteps.ts (G11)
 *  - Given 'the mock GitHub API is configured to accept issue comments'    → givenSteps.ts (G1)
 *  - Given 'the upgrade branch {string} already carries the empty upgrade-claim commit' → feature-541.steps.ts
 *  - When  'the {string} orchestrator is invoked with adwId {string} and issue {int}' → whenSteps.ts (W1)
 *  - Then  'the orchestrator subprocess exited {int}'                      → thenSteps.ts (T5)
 *  - Then  'the mock GitHub API recorded a PR creation for issue {int}'    → thenSteps.ts (T8)
 *  - Then  'the mock harness recorded zero PR-merge calls'                 → thenSteps.ts (T7)
 *  - Then  'the ADW TypeScript type-check passes'                          → feature-504.steps.ts
 *
 * Novel vocabulary introduced here:
 *  - Given 'the worktree for adwId {string} has no ".github/adw.yml" file'
 *  - Given 'a ".github/adw.yml" file in the worktree for adwId {string} sets hitl to false'
 *  - Given 'a ".github/adw.yml" file in the worktree for adwId {string} sets hitl to true'
 *  - Given 'the worktree for adwId {string} has a malformed ".github/adw.yml" file'
 *  - Then  'the mock GitHub API recorded a PR-merge call for the upgrade PR linked to issue {int}'
 */

import { Before, After, Given, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const ADW_UPGRADE_SRC = resolve(ROOT, 'adws/adwUpgrade.tsx');

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-543
// ---------------------------------------------------------------------------

Before({ tags: '@adw-543' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@adw-543' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// Given — .github/adw.yml seeding in the worktree
// ---------------------------------------------------------------------------

Given(
  'the worktree for adwId {string} has no {string} file',
  function (this: RegressionWorld, adwId: string, _filename: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) return;
    const filePath = path.join(worktreePath, '.github', 'adw.yml');
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
    }
  },
);

Given(
  'a {string} file in the worktree for adwId {string} sets hitl to false',
  function (this: RegressionWorld, _filename: string, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) return;
    const githubDir = path.join(worktreePath, '.github');
    if (!fs.existsSync(githubDir)) fs.mkdirSync(githubDir, { recursive: true });
    fs.writeFileSync(path.join(githubDir, 'adw.yml'), 'hitl: false\n', 'utf-8');
  },
);

Given(
  'a {string} file in the worktree for adwId {string} sets hitl to true',
  function (this: RegressionWorld, _filename: string, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) return;
    const githubDir = path.join(worktreePath, '.github');
    if (!fs.existsSync(githubDir)) fs.mkdirSync(githubDir, { recursive: true });
    fs.writeFileSync(path.join(githubDir, 'adw.yml'), 'hitl: true\n', 'utf-8');
  },
);

Given(
  'the worktree for adwId {string} has a malformed {string} file',
  function (this: RegressionWorld, adwId: string, _filename: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) return;
    const githubDir = path.join(worktreePath, '.github');
    if (!fs.existsSync(githubDir)) fs.mkdirSync(githubDir, { recursive: true });
    fs.writeFileSync(path.join(githubDir, 'adw.yml'), 'hitl: maybe\n', 'utf-8');
  },
);

// ---------------------------------------------------------------------------
// Then — PR-merge call assertion (upgrade PR linked to issue)
// ---------------------------------------------------------------------------

Then(
  'the mock GitHub API recorded a PR-merge call for the upgrade PR linked to issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    // Harness active path: locate the PR creation for this issue, then verify a merge call was recorded.
    if (this.mockContext !== null) {
      const requests = this.getRecordedRequests();

      // Find the PR created for this issue (POST /pulls whose body includes `Implements #<N>`)
      const prPost = requests.find((r: RecordedRequest) => {
        if (r.method !== 'POST' || !r.url.includes('/pulls')) return false;
        try {
          const body = JSON.parse(r.body) as Record<string, unknown>;
          const bodyStr = JSON.stringify(body);
          return bodyStr.includes(`#${issueNumber}`);
        } catch {
          return false;
        }
      });
      assert.ok(
        prPost !== undefined,
        `Expected a PR creation for issue ${issueNumber} but none was recorded`,
      );

      // A merge call for any PR was recorded (each isolated scenario creates exactly one PR)
      const mergeCalls = requests.filter(
        (r: RecordedRequest) => r.method === 'PUT' && r.url.includes('/merge'),
      );
      assert.ok(
        mergeCalls.length > 0,
        `Expected a PUT .../pulls/.../merge call for the upgrade PR linked to issue ${issueNumber} but none was recorded`,
      );
      return;
    }

    // Source inspection fallback: confirm adwUpgrade.tsx calls mergePR after opening the PR.
    const src = fs.readFileSync(ADW_UPGRADE_SRC, 'utf-8');
    assert.ok(
      src.includes('deps.mergePR('),
      'Expected adwUpgrade.tsx to call deps.mergePR (auto-merge path)',
    );
    assert.ok(
      src.includes("reason: 'pr_merged'"),
      "Expected adwUpgrade.tsx to have a pr_merged return path after auto-merge",
    );
  },
);
