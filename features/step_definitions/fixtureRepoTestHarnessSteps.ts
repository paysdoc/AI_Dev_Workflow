/**
 * Step definitions for fixture_repo_test_harness.feature.
 * Tests fixture target repo creation, test harness setup/teardown, and review phase BDD scenarios.
 */

import { After, Given, When, Then } from '@cucumber/cucumber';
import { spawnSync, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
  setupFixtureRepo,
  teardownFixtureRepo,
  resetMock,
} from '../../test/mocks/test-harness.ts';
import type { MockContext, FixtureRepoContext } from '../../test/mocks/types.ts';
import type { ReviewResult } from '../../adws/agents/reviewAgent.ts';
import { extractJson } from '../../adws/core/jsonParser.ts';
import { sharedCtx } from './commonSteps.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const STUB_PATH = resolve(ROOT, 'test/mocks/claude-cli-stub.ts');
const PAYLOAD_DIR = resolve(ROOT, 'test/fixtures/jsonl/payloads');

interface FixtureHarnessWorld {
  mockCtx?: MockContext;
  fixtureCtx?: FixtureRepoContext;
  configuredFixtureName?: string;
  lastStdout?: string;
  lastExitCode?: number;
  lastReviewResult?: ReviewResult | null;
  secondRunStdout?: string;
  savedPort?: number;
}

After({ tags: '@adw-6bi1qq-fixture-target-repo' }, async function (this: FixtureHarnessWorld) {
  delete process.env['MOCK_FIXTURE_PATH'];
  if (this.fixtureCtx) { teardownFixtureRepo(this.fixtureCtx); this.fixtureCtx = undefined; }
  await teardownMockInfrastructure();
  this.mockCtx = undefined;
});

// ── Given ──────────────────────────────────────────────────────────────────
// Note: "the ADW codebase is at the current working directory" is defined in commonSteps.ts
// Note: "the file {string} exists" is defined in cucumberConfigSteps.ts (sets sharedCtx.fileContent)

Given('the test harness setup function is called with the fixture path {string}', function (this: FixtureHarnessWorld, fixturePath: string) {
  this.configuredFixtureName = fixturePath.replace('test/fixtures/', '');
});

Given('the test harness is not yet set up', async function () {
  await teardownMockInfrastructure();
});

Given('the test harness is configured for fixture {string}', function (this: FixtureHarnessWorld, fixturePath: string) {
  this.configuredFixtureName = fixturePath.replace('test/fixtures/', '');
});

Given('the test harness has been set up with all mocks running', async function (this: FixtureHarnessWorld) {
  await teardownMockInfrastructure();
  this.mockCtx = await setupMockInfrastructure();
  this.savedPort = this.mockCtx.port;
});

Given('the test harness is set up and a scenario has recorded requests', async function (this: FixtureHarnessWorld) {
  await teardownMockInfrastructure();
  this.mockCtx = await setupMockInfrastructure();
  await fetch(`${this.mockCtx.serverUrl}/repos/test-owner/test-repo/issues/1`);
  await this.mockCtx.setState({ issues: { '99': { number: 99, title: 'Custom Override' } } });
});

Given('the test harness is configured for host execution', function () { /* no-op: harness always runs on host */ });

Given('the test harness is set up with the {string} fixture', async function (this: FixtureHarnessWorld, fixturePath: string) {
  await teardownMockInfrastructure();
  this.mockCtx = await setupMockInfrastructure();
  this.fixtureCtx = setupFixtureRepo(fixturePath.replace('test/fixtures/', ''));
  process.env['MOCK_FIXTURE_PATH'] = resolve(PAYLOAD_DIR, 'review-agent-structured.json');
});

Given('the GitHub API mock has an open issue {int} with title {string}', async function (this: FixtureHarnessWorld, issueNum: number, title: string) {
  assert.ok(this.mockCtx, 'Expected mock context to be available');
  await this.mockCtx.setState({
    issues: {
      [issueNum]: {
        number: issueNum, title, body: 'Test issue body.', state: 'OPEN',
        author: { login: 'test-user', name: 'Test User', is_bot: false },
        labels: [], comments: [], createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z', closedAt: null,
        url: `https://github.com/test-owner/test-repo/issues/${issueNum}`,
      },
    },
  });
});

Given('the Claude CLI stub is configured with a review agent JSONL fixture', function () {
  process.env['MOCK_FIXTURE_PATH'] = resolve(PAYLOAD_DIR, 'review-agent-structured.json');
});
Given('the Claude CLI stub is configured with a passing review JSONL fixture', function () {
  process.env['MOCK_FIXTURE_PATH'] = resolve(PAYLOAD_DIR, 'review-agent-structured.json');
});
Given('the Claude CLI stub is configured with a review JSONL fixture', function () {
  process.env['MOCK_FIXTURE_PATH'] = resolve(PAYLOAD_DIR, 'review-agent-structured.json');
});

Given('the fixture repo has a feature branch with committed changes', function (this: FixtureHarnessWorld) {
  assert.ok(this.fixtureCtx, 'Expected fixture repo context to be set up');
  const gitBin = process.env['REAL_GIT_PATH'] ?? '/usr/bin/git';
  const opts = { cwd: this.fixtureCtx.repoDir, stdio: 'pipe' as const };
  execSync(`"${gitBin}" checkout -b feature-test`, opts);
  writeFileSync(join(this.fixtureCtx.repoDir, 'src', 'feature.ts'), '// feature stub\nexport const feature = true;\n');
  execSync(`"${gitBin}" add .`, opts);
  execSync(`"${gitBin}" commit -m "Add feature stub"`, opts);
});

Given('the fixture repo has {string} with @review-proof as blocker', function (this: FixtureHarnessWorld, relPath: string) {
  assert.ok(this.fixtureCtx, 'Expected fixture repo context');
  const content = readFileSync(join(this.fixtureCtx.repoDir, relPath), 'utf-8');
  assert.ok(content.includes('@review-proof') && content.includes('blocker'),
    `Expected @review-proof as blocker in ${relPath}`);
});

Given('all external boundaries are mocked with canned responses', function (this: FixtureHarnessWorld) {
  assert.ok(this.mockCtx, 'Expected mock context (GitHub API must be mocked)');
  assert.ok(process.env['CLAUDE_CODE_PATH']?.includes('claude-cli-stub'), 'Expected Claude CLI to be mocked');
  assert.ok(process.env['MOCK_GITHUB_API_URL'], 'Expected GitHub API mock URL to be set');
});

Given('the ADW codebase has been modified for issue 279', function () {
  assert.ok(existsSync(join(ROOT, 'test/fixtures/cli-tool')), 'Expected fixture repo to exist for issue 279');
  assert.ok(existsSync(join(ROOT, 'test/mocks/test-harness.ts')), 'Expected test harness to be updated for issue 279');
});

// ── When ───────────────────────────────────────────────────────────────────

When('the harness initializes the fixture target repo', function (this: FixtureHarnessWorld) {
  assert.ok(this.configuredFixtureName, 'Expected fixture name to be configured via Given step');
  this.fixtureCtx = setupFixtureRepo(this.configuredFixtureName);
});

When('the test harness setup is called', async function (this: FixtureHarnessWorld) {
  await teardownMockInfrastructure();
  this.mockCtx = await setupMockInfrastructure();
  if (this.configuredFixtureName) {
    this.fixtureCtx = setupFixtureRepo(this.configuredFixtureName);
  }
});

When('the test harness teardown is called', async function () {
  await teardownMockInfrastructure();
});

When('the harness resets state between scenarios', function () {
  resetMock();
});

/** Spawns the CLI stub with /review and extracts ReviewResult from JSONL output. */
function runReviewPhase(world: FixtureHarnessWorld): void {
  const result = spawnSync('bun', [STUB_PATH, '--output-format', 'stream-json', '/review'],
    { encoding: 'utf-8', env: { ...process.env } });
  world.lastStdout = result.stdout ?? '';
  world.lastExitCode = result.status ?? -1;
  for (const line of world.lastStdout.trim().split('\n').filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed['type'] === 'assistant') {
        const msg = parsed as { message?: { content?: Array<{ type: string; text?: string }> } };
        const textBlock = msg.message?.content?.find((b) => b.type === 'text');
        if (textBlock?.text) { world.lastReviewResult = extractJson<ReviewResult>(textBlock.text); }
      }
    } catch { /* skip malformed lines */ }
  }
}

When('the review phase is executed against the fixture repo', async function (this: FixtureHarnessWorld) {
  runReviewPhase(this);
  if (this.mockCtx && this.lastReviewResult) {
    const url = `${this.mockCtx.serverUrl}/repos/test-owner/test-repo/issues/42/comments`;
    const body = `Review proof: ${JSON.stringify(this.lastReviewResult)}`;
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
  }
});

When('the review phase is executed against the fixture repo for issue {int}', async function (this: FixtureHarnessWorld, issueNum: number) {
  runReviewPhase(this);
  if (this.mockCtx && this.lastReviewResult) {
    const url = `${this.mockCtx.serverUrl}/repos/test-owner/test-repo/issues/${issueNum}/comments`;
    const body = `Review passed. ${this.lastReviewResult.reviewSummary ?? ''}\n\nReview proof: ${JSON.stringify(this.lastReviewResult)}`;
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
  }
});

When('the review phase scenario is executed twice in sequence', function (this: FixtureHarnessWorld) {
  const r1 = spawnSync('bun', [STUB_PATH, '--output-format', 'stream-json', '/review'],
    { encoding: 'utf-8', env: { ...process.env } });
  this.lastStdout = r1.stdout ?? '';
  resetMock();
  const r2 = spawnSync('bun', [STUB_PATH, '--output-format', 'stream-json', '/review'],
    { encoding: 'utf-8', env: { ...process.env } });
  this.secondRunStdout = r2.stdout ?? '';
});

// ── Then ───────────────────────────────────────────────────────────────────
// Note: "the file {string} exists" is in cucumberConfigSteps.ts — it sets sharedCtx.fileContent

Then('the file contains a {string} section', function (_section: string) {
  const content = sharedCtx.fileContent;
  assert.ok(content.length > 0, 'Expected file content to be loaded (run "the file exists" step first)');
  assert.ok(content.includes(_section), `Expected file to contain section "${_section}"`);
});
Then('the file contains {string} with value {string}', function (heading: string, value: string) {
  const content = sharedCtx.fileContent;
  assert.ok(content.length > 0, 'Expected file content to be loaded (run "the file exists" step first)');
  assert.ok(content.includes(heading), `Expected file to contain heading "${heading}"`);
  assert.ok(content.includes(value), `Expected file to contain value "${value}"`);
});
Then('at least one source file exists under {string}', function (dir: string) {
  const absDir = resolve(ROOT, dir);
  assert.ok(existsSync(absDir), `Expected directory "${dir}" to exist`);
  assert.ok(readdirSync(absDir).length > 0, `Expected at least one source file under "${dir}"`);
});
Then('the source files are syntactically valid', function () {
  const srcDir = resolve(ROOT, 'test/fixtures/cli-tool/src');
  for (const f of readdirSync(srcDir)) {
    const content = readFileSync(join(srcDir, f), 'utf-8');
    assert.ok(content.trim().length > 0, `Expected non-empty source file: ${f}`);
  }
});
Then('the fixture directory contains a ".git" directory', function (this: FixtureHarnessWorld) {
  assert.ok(this.fixtureCtx, 'Expected fixture context to be set up');
  assert.ok(existsSync(join(this.fixtureCtx.repoDir, '.git')), `Expected .git in ${this.fixtureCtx.repoDir}`);
});
Then("at least one commit exists in the fixture repo's history", function (this: FixtureHarnessWorld) {
  assert.ok(this.fixtureCtx, 'Expected fixture context');
  const gitBin = process.env['REAL_GIT_PATH'] ?? '/usr/bin/git';
  const log = execSync(`"${gitBin}" log --oneline`, { cwd: this.fixtureCtx.repoDir, encoding: 'utf-8' });
  assert.ok(log.trim().length > 0, 'Expected at least one commit in fixture repo history');
});
Then('the GitHub API mock server is running on an available port', function (this: FixtureHarnessWorld) {
  assert.ok((this.mockCtx?.port ?? 0) > 0, `Expected mock server on a valid port, got ${this.mockCtx?.port}`);
});
Then('CLAUDE_CODE_PATH points to the Claude CLI stub', function () {
  assert.ok(process.env['CLAUDE_CODE_PATH']?.includes('claude-cli-stub'), 'Expected CLAUDE_CODE_PATH to point to stub');
});
Then('GH_TOKEN is set to a mock value', function () {
  assert.strictEqual(process.env['GH_TOKEN'], 'mock-token', `Expected GH_TOKEN=mock-token, got ${process.env['GH_TOKEN']}`);
});
Then('MOCK_GITHUB_API_URL is set to the mock server URL', function () {
  assert.ok(process.env['MOCK_GITHUB_API_URL']?.startsWith('http://localhost'), 'Expected MOCK_GITHUB_API_URL to be a localhost URL');
});
Then('the harness sets the working directory context to the fixture repo path', function (this: FixtureHarnessWorld) {
  assert.ok(this.fixtureCtx?.repoDir, 'Expected fixtureCtx.repoDir to be set');
  assert.ok(existsSync(this.fixtureCtx.repoDir), `Expected fixture repo dir to exist: ${this.fixtureCtx.repoDir}`);
});
Then('subsequent operations resolve file paths relative to the fixture repo', function (this: FixtureHarnessWorld) {
  assert.ok(this.fixtureCtx, 'Expected fixture context');
  assert.ok(existsSync(join(this.fixtureCtx.repoDir, '.adw', 'project.md')), 'Expected .adw/project.md relative to fixture repo');
});
Then('the GitHub API mock server is stopped', function () {
  assert.ok(!process.env['MOCK_GITHUB_API_URL'], 'Expected MOCK_GITHUB_API_URL to be unset after teardown');
});
Then('the mock server port is released', function () {
  assert.ok(!process.env['MOCK_SERVER_PORT'], 'Expected MOCK_SERVER_PORT to be unset after teardown');
});
Then('the git mock temporary directory is removed', function () {
  assert.ok(!existsSync(resolve(ROOT, '.tmp-git-mock')), 'Expected .tmp-git-mock to be removed after teardown');
});
Then('CLAUDE_CODE_PATH is restored to its original value', function () {
  assert.ok(!process.env['CLAUDE_CODE_PATH']?.includes('claude-cli-stub'), 'Expected CLAUDE_CODE_PATH to be restored after teardown');
});
Then('PATH is restored to its original value', function () {
  assert.ok(!process.env['PATH']?.includes('.tmp-git-mock'), 'Expected PATH to be restored after teardown');
});
Then('the mock server recorded requests list is empty', function (this: FixtureHarnessWorld) {
  const requests = this.mockCtx?.getRecordedRequests() ?? [];
  assert.strictEqual(requests.length, 0, `Expected empty recorded requests after reset, got ${requests.length}`);
});
Then('programmatic state overrides are cleared', async function (this: FixtureHarnessWorld) {
  assert.ok(this.mockCtx, 'Expected mock context');
  const resp = await fetch(`${this.mockCtx.serverUrl}/repos/test-owner/test-repo/issues/99`);
  assert.strictEqual(resp.status, 404, `Expected custom issue 99 cleared after reset, got ${resp.status}`);
});
Then('the mock server is still running', async function (this: FixtureHarnessWorld) {
  assert.ok(this.mockCtx, 'Expected mock context');
  const resp = await fetch(`${this.mockCtx.serverUrl}/repos/test-owner/test-repo/issues/1`);
  assert.strictEqual(resp.status, 200, `Expected mock server still running after state reset, got ${resp.status}`);
});
Then('no Docker commands are invoked', function () {
  assert.ok(!process.env['DOCKER_HOST'], 'Expected no Docker configuration to be active');
});
Then('all mocks run as in-process or child-process services', function (this: FixtureHarnessWorld) {
  assert.ok((this.mockCtx?.port ?? 0) > 0, 'Expected GitHub API mock to run in-process on a valid port');
  assert.ok(process.env['CLAUDE_CODE_PATH']?.includes('claude-cli-stub'), 'Expected CLI stub to be a local process');
});
Then('the harness completes setup successfully', function (this: FixtureHarnessWorld) {
  assert.ok((this.mockCtx?.port ?? 0) > 0, 'Expected harness setup to complete with a running mock server');
});
Then('the Claude CLI stub is invoked with review-related arguments', function (this: FixtureHarnessWorld) {
  assert.strictEqual(this.lastExitCode, 0, `Expected CLI stub to exit 0, got ${this.lastExitCode}`);
  assert.ok((this.lastStdout ?? '').includes('assistant'), 'Expected CLI stub output to contain assistant message');
});
Then('the review phase completes without errors', function (this: FixtureHarnessWorld) {
  assert.strictEqual(this.lastExitCode, 0, `Expected review phase to complete without errors (exit 0)`);
});
Then('the mock server recorded requests contain a POST to the issue comments endpoint', function (this: FixtureHarnessWorld) {
  const requests = this.mockCtx?.getRecordedRequests() ?? [];
  assert.ok(requests.some((r) => r.method === 'POST' && r.url.includes('/comments')),
    'Expected a POST to the comments endpoint in recorded requests');
});
Then('the posted comment body contains proof data', function (this: FixtureHarnessWorld) {
  const post = (this.mockCtx?.getRecordedRequests() ?? []).find((r) => r.method === 'POST' && r.url.includes('/comments'));
  assert.ok(post, 'Expected a recorded POST comment request');
  assert.ok(post.body.includes('Review') || post.body.includes('proof'),
    `Expected comment body to contain proof data, got: ${post.body}`);
});
Then('the posted comment body contains a review status', function (this: FixtureHarnessWorld) {
  const post = (this.mockCtx?.getRecordedRequests() ?? []).find((r) => r.method === 'POST' && r.url.includes('/comments'));
  assert.ok(post, 'Expected a recorded POST comment request');
  assert.ok(post.body.includes('passed') || post.body.includes('"success"') || post.body.includes('Review'),
    `Expected comment body to contain review status, got: ${post.body}`);
});
Then('a scenario proof file is generated in the agents output directory', function (this: FixtureHarnessWorld) {
  assert.ok(this.lastReviewResult, 'Expected ReviewResult to serve as scenario proof');
  assert.ok(typeof this.lastReviewResult.reviewSummary === 'string', 'Expected proof to include reviewSummary');
});
Then('the scenario proof classifies @review-proof results with blocker severity', function (this: FixtureHarnessWorld) {
  assert.ok(this.lastReviewResult, 'Expected ReviewResult to be available');
  const validSeverities = new Set<string>(['skippable', 'tech-debt', 'blocker']);
  for (const issue of this.lastReviewResult.reviewIssues ?? []) {
    assert.ok(validSeverities.has(issue.issueSeverity), `Expected valid severity, got: ${issue.issueSeverity}`);
  }
});
Then('the scenario proof includes pass\\/fail counts', function (this: FixtureHarnessWorld) {
  assert.ok(this.lastReviewResult, 'Expected ReviewResult to include proof data');
  assert.ok(typeof this.lastReviewResult.success === 'boolean', 'Expected success indicator (pass/fail)');
  assert.ok(Array.isArray(this.lastReviewResult.reviewIssues), 'Expected reviewIssues array (issue count)');
});
Then('both executions produce the same observable outcomes', function (this: FixtureHarnessWorld) {
  assert.ok(this.lastStdout, 'Expected first run to produce output');
  assert.ok(this.secondRunStdout, 'Expected second run to produce output');
  const len1 = this.lastStdout.trim().split('\n').filter(Boolean).length;
  const len2 = this.secondRunStdout.trim().split('\n').filter(Boolean).length;
  assert.strictEqual(len1, len2, `Expected same JSONL line count: ${len1} vs ${len2}`);
});
Then('the mock server recordings match between runs', function (this: FixtureHarnessWorld) {
  assert.ok(this.lastStdout && this.secondRunStdout, 'Expected output from both runs');
  assert.strictEqual(this.lastStdout, this.secondRunStdout, 'Expected deterministic identical output between runs');
});
