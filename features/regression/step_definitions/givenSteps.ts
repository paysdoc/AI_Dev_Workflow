/**
 * Given step definitions for @regression scenarios.
 *
 * Execution pattern: mock-query (state seeding) and subprocess (artefact setup).
 * All steps are side-effect-free with respect to source files in adws/.
 *
 * Vocabulary phrases: G1–G11 (see features/regression/vocabulary.md).
 */

import { Given } from '@cucumber/cucumber';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import assert from 'assert';
import type { RegressionWorld } from './world.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const PAYLOAD_DIR = join(ROOT, 'test/fixtures/jsonl/payloads');

// ---------------------------------------------------------------------------
// G1: mock GitHub API configured to accept issue comments
// ---------------------------------------------------------------------------

Given(
  'the mock GitHub API is configured to accept issue comments',
  async function (this: RegressionWorld) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    // The mock server already handles POST /repos/.../issues/:n/comments by default.
    // This step makes the intent explicit — no additional state seeding is needed.
    await this.mockContext.setState({});
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

// ---------------------------------------------------------------------------
// G2: git-mock has a clean worktree at branch {string}
// ---------------------------------------------------------------------------

Given(
  'the git-mock has a clean worktree at branch {string}',
  function (this: RegressionWorld, branch: string) {
    this.targetBranch = branch;
    // Git invocation recording is reset between scenarios via the mock harness.
    // Storing the branch name here makes it available to T4 / T11 assertions.
  },
);

// ---------------------------------------------------------------------------
// G3: claude-cli-stub loaded with manifest {string}
// ---------------------------------------------------------------------------

Given(
  'the claude-cli-stub is loaded with manifest {string}',
  function (this: RegressionWorld, manifestRelPath: string) {
    const absoluteManifestPath = resolve(ROOT, manifestRelPath);
    this.harnessEnv = {
      ...this.harnessEnv,
      MOCK_MANIFEST_PATH: absoluteManifestPath,
    };
  },
);

// ---------------------------------------------------------------------------
// G4: an issue {int} exists in the mock issue tracker
// ---------------------------------------------------------------------------

Given(
  'an issue {int} exists in the mock issue tracker',
  async function (this: RegressionWorld, issueNumber: number) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    await this.mockContext.setState({
      issues: {
        [String(issueNumber)]: {
          number: issueNumber,
          title: `Issue ${issueNumber}`,
          state: 'open',
          body: '',
          user: { login: 'test-user' },
          labels: [],
        },
      },
    });
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

// ---------------------------------------------------------------------------
// G5: no spawn lock exists for issue {int}
// ---------------------------------------------------------------------------

Given(
  'no spawn lock exists for issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    // The orchestrator lock artefact is a file written at runtime by the orchestrator
    // under test. Asserting its absence here ensures the scenario starts clean.
    const lockPath = resolve(ROOT, `.adw/locks/issue-${issueNumber}.lock`);
    if (existsSync(lockPath)) {
      rmSync(lockPath);
    }
    // Nothing else to do — the orchestrator will create/release the lock during W1.
  },
);

// ---------------------------------------------------------------------------
// G6: a state file exists for adwId {string} at stage {string}
// ---------------------------------------------------------------------------

Given(
  'a state file exists for adwId {string} at stage {string}',
  function (this: RegressionWorld, adwId: string, stage: string) {
    const worktreeBase = mkdtempSync(join(tmpdir(), `adw-reg-${adwId}-`));
    this.worktreePaths.set(adwId, worktreeBase);

    const stateDir = join(worktreeBase, '.adw');
    mkdirSync(stateDir, { recursive: true });

    const stateFile = join(stateDir, 'state.json');
    const state = { adwId, workflowStage: stage, issueNumber: 0 };
    writeFileSync(stateFile, JSON.stringify(state), 'utf-8');

    this.harnessEnv = {
      ...this.harnessEnv,
      MOCK_WORKTREE_PATH: worktreeBase,
    };
  },
);

// ---------------------------------------------------------------------------
// G7: cron sweep configured with empty queue
// ---------------------------------------------------------------------------

Given(
  'the cron sweep is configured with empty queue',
  async function (this: RegressionWorld) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    // An empty issues map means the cron probe will find no eligible issues.
    await this.mockContext.setState({ issues: {} });
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

// ---------------------------------------------------------------------------
// G8: mock GitHub API records all PR-list calls
// ---------------------------------------------------------------------------

Given(
  'the mock GitHub API records all PR-list calls',
  function (this: RegressionWorld) {
    // Recording is enabled by default on the mock server.
    // This step is a documentation step that makes the intent explicit.
    if (this.mockContext) {
      const serverUrl = this.mockContext.serverUrl;
      this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
    }
  },
);

// ---------------------------------------------------------------------------
// G9: claude-cli-stub loaded with fixture {string}
// ---------------------------------------------------------------------------

Given(
  'the claude-cli-stub is loaded with fixture {string}',
  function (this: RegressionWorld, fixtureRelPath: string) {
    const absoluteFixturePath = resolve(PAYLOAD_DIR, fixtureRelPath);
    this.harnessEnv = {
      ...this.harnessEnv,
      MOCK_FIXTURE_PATH: absoluteFixturePath,
    };
  },
);

// ---------------------------------------------------------------------------
// G10: mock GitHub API returns PR {int} as merged
// ---------------------------------------------------------------------------

Given(
  'the mock GitHub API is configured to return PR {int} as merged',
  async function (this: RegressionWorld, prNumber: number) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    await this.mockContext.setState({
      prs: {
        [String(prNumber)]: {
          number: prNumber,
          state: 'closed',
          merged: true,
          merged_at: new Date().toISOString(),
        },
      },
    });
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

// ---------------------------------------------------------------------------
// G11: worktree for adwId {string} initialised at branch {string}
// ---------------------------------------------------------------------------

Given(
  'the worktree for adwId {string} is initialised at branch {string}',
  function (this: RegressionWorld, adwId: string, branch: string) {
    const worktreeBase = mkdtempSync(join(tmpdir(), `adw-wt-${adwId}-`));
    this.worktreePaths.set(adwId, worktreeBase);
    this.targetBranch = branch;

    // Initialise as a bare git repo so the orchestrator can operate on it.
    const gitBin = process.env['REAL_GIT_PATH'] ?? 'git';
    execSync(`"${gitBin}" init`, { cwd: worktreeBase, stdio: 'pipe' });
    execSync(`"${gitBin}" config user.email "test@adw.local"`, { cwd: worktreeBase, stdio: 'pipe' });
    execSync(`"${gitBin}" config user.name "ADW Regression"`, { cwd: worktreeBase, stdio: 'pipe' });
    execSync(`"${gitBin}" checkout -b "${branch}"`, { cwd: worktreeBase, stdio: 'pipe' });

    this.harnessEnv = {
      ...this.harnessEnv,
      MOCK_WORKTREE_PATH: worktreeBase,
    };
  },
);
