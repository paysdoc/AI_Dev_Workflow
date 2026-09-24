// All steps are side-effect-free with respect to source files in adws/.

import { Given } from '@cucumber/cucumber';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import assert from 'assert';
import type { RegressionWorld } from './world.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const PAYLOAD_DIR = join(ROOT, 'test/fixtures/jsonl/payloads');

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

Given(
  'no spawn lock exists for issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    const lockPath = resolve(ROOT, `.adw/locks/issue-${issueNumber}.lock`);
    if (existsSync(lockPath)) {
      rmSync(lockPath);
    }
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

Given(
  'the cron sweep is configured with empty queue',
  async function (this: RegressionWorld) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    await this.mockContext.setState({ issues: {} });
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

Given(
  'the mock GitHub API is configured to accept label applications',
  function (this: RegressionWorld) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    // The mock server records all POST /repos/.../issues/:n/labels by default.
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

function insertTagAtHeader(lines: string[], headerIdx: number, newTag: string): string {
  let nearestTagIdx = -1;
  for (let i = headerIdx - 1; i >= 0; i--) {
    const trimmed = (lines[i] ?? '').trimStart();
    if (trimmed.startsWith('@')) {
      if (nearestTagIdx === -1) nearestTagIdx = i;
    } else if (trimmed.length > 0) {
      break;
    }
  }
  if (nearestTagIdx !== -1) {
    lines[nearestTagIdx] = `${lines[nearestTagIdx]} ${newTag}`;
  } else {
    const indent = (lines[headerIdx] ?? '').match(/^(\s*)/)?.[1] ?? '';
    lines.splice(headerIdx, 0, `${indent}${newTag}`);
  }
  return lines.join('\n');
}

function insertTagForScenario(content: string, scenarioName: string | null, newTag: string): string {
  const lines = content.split('\n');
  const headerIdx = scenarioName === null
    ? lines.findIndex((l) => /^\s*Scenario:/.test(l))
    : lines.findIndex((l) => {
        const t = l.trimStart();
        return t.startsWith('Scenario:') && t.slice('Scenario:'.length).trim() === scenarioName;
      });
  if (headerIdx === -1) {
    throw new Error(scenarioName === null
      ? 'No Scenario: header found in feature file'
      : `Scenario "${scenarioName}" not found in feature file`);
  }
  return insertTagAtHeader(lines, headerIdx, newTag);
}

Given(
  'the seeded scenario in {string} in the worktree for adwId {string} is pre-tagged with "@promotion-suggested-" dated today',
  function (this: RegressionWorld, filePath: string, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree found for adwId "${adwId}"`);
    const fullPath = join(worktreePath, filePath);
    const today = new Date().toISOString().slice(0, 10);
    const tag = `@promotion-suggested-${today}`;
    const updated = insertTagForScenario(readFileSync(fullPath, 'utf-8'), null, tag);
    writeFileSync(fullPath, updated, 'utf-8');
  },
);

Given(
  'the seeded scenario in {string} in the worktree for adwId {string} is pre-tagged with "@promotion-suggested-" dated {int} days ago',
  function (this: RegressionWorld, filePath: string, adwId: string, daysAgo: number) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree found for adwId "${adwId}"`);
    const fullPath = join(worktreePath, filePath);
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const tag = `@promotion-suggested-${d.toISOString().slice(0, 10)}`;
    const updated = insertTagForScenario(readFileSync(fullPath, 'utf-8'), null, tag);
    writeFileSync(fullPath, updated, 'utf-8');
  },
);

Given(
  'the seeded scenario named {string} in {string} in the worktree for adwId {string} is pre-tagged with "@promotion-suggested-" dated today',
  function (this: RegressionWorld, scenarioName: string, filePath: string, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree found for adwId "${adwId}"`);
    const fullPath = join(worktreePath, filePath);
    const today = new Date().toISOString().slice(0, 10);
    const tag = `@promotion-suggested-${today}`;
    const updated = insertTagForScenario(readFileSync(fullPath, 'utf-8'), scenarioName, tag);
    writeFileSync(fullPath, updated, 'utf-8');
  },
);

Given(
  'the seeded scenario named {string} in {string} in the worktree for adwId {string} is pre-tagged with "@promotion-suggested-" dated {int} days ago',
  function (this: RegressionWorld, scenarioName: string, filePath: string, adwId: string, daysAgo: number) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree found for adwId "${adwId}"`);
    const fullPath = join(worktreePath, filePath);
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const tag = `@promotion-suggested-${d.toISOString().slice(0, 10)}`;
    const updated = insertTagForScenario(readFileSync(fullPath, 'utf-8'), scenarioName, tag);
    writeFileSync(fullPath, updated, 'utf-8');
  },
);

Given(
  'the worktree for adwId {string} is initialised at branch {string}',
  function (this: RegressionWorld, adwId: string, branch: string) {
    const worktreeBase = mkdtempSync(join(tmpdir(), `adw-wt-${adwId}-`));
    this.worktreePaths.set(adwId, worktreeBase);
    this.targetBranch = branch;

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
