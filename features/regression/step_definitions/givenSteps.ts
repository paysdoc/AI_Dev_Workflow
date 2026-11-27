// All steps are side-effect-free with respect to source files in adws/.

import { Given } from '@cucumber/cucumber';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import assert from 'assert';
import type { RegressionWorld } from './world.ts';
import { releaseIssueSpawnLock } from '../../../adws/triggers/spawnGate.ts';
import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import { initialiseFixtureWorktree } from '../support/fixtureWorktree.ts';
import { SURFACE_REPO } from '../support/mockForgeProviders.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const PAYLOAD_DIR = join(ROOT, 'test/fixtures/jsonl/payloads');

/** Older than the cron's grace period, so the cron does not filter the seeded issue out as one a webhook may still be handling. */
const SEEDED_ISSUE_AGE_MS = 60 * 60_000;

Given(
  'the mock GitHub API is configured to accept issue comments',
  async function (this: RegressionWorld) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    // The mock server already handles POST /repos/.../issues/:n/comments by default.
    await this.mockContext.setState({});
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

Given(
  'the git-mock has a clean worktree at branch {string}',
  function (this: RegressionWorld, branch: string) {
    this.targetBranch = branch;
  },
);

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

// The adw:feature label is one the cron's eligibility filter admits and the webhook gatekeeper routes to adwSdlc.tsx.
Given(
  'an issue {int} exists in the mock issue tracker',
  async function (this: RegressionWorld, issueNumber: number) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    const anHourAgo = new Date(Date.now() - SEEDED_ISSUE_AGE_MS).toISOString();
    await this.mockContext.setState({
      issues: {
        [String(issueNumber)]: {
          number: issueNumber,
          title: `Issue ${issueNumber}`,
          state: 'open',
          body: '',
          user: { login: 'test-user' },
          labels: [{ name: 'adw:feature' }],
          created_at: anHourAgo,
          updated_at: anHourAgo,
        },
      },
    });
    // The state now holds exactly this issue.
    this.seededIssues = new Set([issueNumber]);
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

Given(
  'no spawn lock exists for issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    releaseIssueSpawnLock(SURFACE_REPO, issueNumber);
  },
);

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

// Keeps the issues the scenario seeded, so the mock server's default fixture issues are the ones that go.
Given(
  'the cron sweep is configured with empty queue',
  async function (this: RegressionWorld) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    const current = getMockServerState().issues;
    const seeded = [...this.seededIssues].filter((issueNumber) => String(issueNumber) in current);
    await this.mockContext.setState({ issues: Object.fromEntries(seeded.map((issueNumber) => [String(issueNumber), current[String(issueNumber)]])) });
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

Given(
  'the mock GitHub API records all PR-list calls',
  function (this: RegressionWorld) {
    // Recording is enabled by default on the mock server.
    if (this.mockContext) {
      const serverUrl = this.mockContext.serverUrl;
      this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
    }
  },
);

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

Given(
  'the mock GitHub API is configured to return PR {int} as merged',
  async function (this: RegressionWorld, prNumber: number) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    // Marked in place, so what an earlier Given recorded for the pull request, its head branch above all, survives.
    const { prs } = getMockServerState();
    await this.mockContext.setState({
      prs: {
        ...prs,
        [String(prNumber)]: {
          ...(prs[String(prNumber)] as Record<string, unknown> | undefined),
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

Given(
  'the mock GitHub API is configured to accept label applications',
  function (this: RegressionWorld) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    // The mock server records all POST /repos/.../issues/:n/labels by default.
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

Given(
  'the worktree for adwId {string} is initialised at branch {string}',
  function (this: RegressionWorld, adwId: string, branch: string) {
    const { base, worktreePath } = initialiseFixtureWorktree(adwId, branch);
    this.cleanup.push(() => rmSync(base, { recursive: true, force: true }));
    this.worktreePaths.set(adwId, worktreePath);
    this.targetBranch = branch;

    this.harnessEnv = {
      ...this.harnessEnv,
      MOCK_WORKTREE_PATH: worktreePath,
    };
  },
);

Given('the ADW codebase is checked out', function () {
  // Deliberate no-op: every scenario already runs inside the ADW checkout.
});
