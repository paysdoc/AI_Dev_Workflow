/**
 * BDD step definitions for feature-509.feature
 * promotionCommenter MVP — score, tag, and comment on per-issue PR events
 *
 * Design decisions:
 *  - Reuses the regression mock harness (setupMockInfrastructure / teardownMockInfrastructure)
 *    via a Before/After hook tagged @adw-509. This makes the regression Given steps
 *    (G3, G4, G11) that depend on this.mockContext usable from these per-issue scenarios.
 *  - The W1 step `the "X" orchestrator is invoked with adwId ... and issue ...` is owned
 *    by features/regression/step_definitions/whenSteps.ts and intentionally returns
 *    'pending' until the harness can drive a real subprocess to completion (per the
 *    ISSUE-3-CUTOVER stub in whenSteps.ts and the plan in
 *    specs/issue-509-...-deep-modules.md §11). Consequently the Then steps downstream
 *    of W1 are skipped at runtime; the missing step definitions below are stubs that
 *    return 'pending' so the scenarios are marked PENDING rather than FAILED/UNDEFINED.
 *    They become live assertions in slice #5 when subprocess invocation lands.
 */

import { Given, Then, Before, After } from '@cucumber/cucumber';
import { readFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SCENARIOS_FIXTURE_DIR = join(ROOT, 'test/fixtures/scenarios');

function extractTagBlock(lines: string[], headerIdx: number): string[] {
  const tags: string[] = [];
  for (let i = headerIdx - 1; i >= 0; i--) {
    const trimmed = (lines[i] ?? '').trimStart();
    if (trimmed.startsWith('@')) {
      tags.push(...trimmed.split(/\s+/).filter((t) => t.startsWith('@')));
    } else if (trimmed.length > 0) {
      break;
    }
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-509 so they don't fire on every
// scenario (and don't interfere with the @regression hook ordering).
// ---------------------------------------------------------------------------

Before({ tags: '@adw-509' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@adw-509' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// Given — fixture seeding (pending until subprocess invocation lands; see file header)
// ---------------------------------------------------------------------------

Given(
  'a per-issue feature file at {string} is seeded into the worktree for adwId {string} from fixture {string}',
  function (this: RegressionWorld, targetPath: string, adwId: string, fixturePath: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree found for adwId "${adwId}"`);
    const src = join(SCENARIOS_FIXTURE_DIR, fixturePath);
    const dest = join(worktreePath, targetPath);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  },
);

// ---------------------------------------------------------------------------
// Then — artefact-file tag assertions (pending; see file header)
// ---------------------------------------------------------------------------

Then(
  'the artefact file at {string} in the worktree for adwId {string} carries a {string} tag dated today on the seeded scenario',
  function (this: RegressionWorld, targetPath: string, adwId: string, tagPrefix: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree found for adwId "${adwId}"`);
    const content = readFileSync(join(worktreePath, targetPath), 'utf-8');
    const today = new Date().toISOString().slice(0, 10);
    const expectedTag = `${tagPrefix}${today}`;
    const lines = content.split('\n');
    const headerIdx = lines.findIndex((l) => /^\s*Scenario:/.test(l));
    assert.ok(headerIdx >= 0, 'No Scenario: header found in artefact file');
    const tags = extractTagBlock(lines, headerIdx);
    assert.ok(
      tags.includes(expectedTag),
      `Expected tag "${expectedTag}" in tag block before first Scenario but not found. Tags: ${tags.join(' ')}`,
    );
  },
);

Then(
  'the artefact file at {string} in the worktree for adwId {string} carries no {string} tag on the seeded scenario',
  function (this: RegressionWorld, targetPath: string, adwId: string, tagPrefix: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree found for adwId "${adwId}"`);
    const content = readFileSync(join(worktreePath, targetPath), 'utf-8');
    const lines = content.split('\n');
    const headerIdx = lines.findIndex((l) => /^\s*Scenario:/.test(l));
    assert.ok(headerIdx >= 0, 'No Scenario: header found in artefact file');
    const tags = extractTagBlock(lines, headerIdx);
    const escapedPrefix = tagPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tagRe = new RegExp(`${escapedPrefix}\\d{4}-\\d{2}-\\d{2}`);
    const found = tags.some((t) => tagRe.test(t));
    assert.ok(
      !found,
      `Expected no "${tagPrefix}*" tag in tag block before first Scenario but found one. Tags: ${tags.join(' ')}`,
    );
  },
);

Then(
  'the artefact file at {string} in the worktree for adwId {string} carries a {string} tag dated today on the targeted scenario',
  function (_targetPath: string, _adwId: string, _tagPrefix: string) {
    return 'pending';
  },
);

Then(
  'the artefact file at {string} in the worktree for adwId {string} carries a {string} tag dated today on every scenario whose score is at least {int}',
  function (_targetPath: string, _adwId: string, _tagPrefix: string, _threshold: number) {
    return 'pending';
  },
);

Then(
  'the artefact file at {string} in the worktree for adwId {string} carries no {string} tag on any scenario whose score is below {int}',
  function (_targetPath: string, _adwId: string, _tagPrefix: string, _threshold: number) {
    return 'pending';
  },
);

Then(
  'every line of the artefact file at {string} in the worktree for adwId {string} that is not the inserted tag line is byte-identical to the pre-invocation contents',
  function (_targetPath: string, _adwId: string) {
    return 'pending';
  },
);

// ---------------------------------------------------------------------------
// Then — mock-harness call-count and comment-body assertions (pending; see file header)
// ---------------------------------------------------------------------------

Then(
  'the mock harness recorded zero comment posts on issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    const requests = this.getRecordedRequests();
    const commentPosts = requests.filter(
      (r: RecordedRequest) =>
        r.method === 'POST' && r.url.includes(`/issues/${issueNumber}/comments`),
    );
    assert.strictEqual(
      commentPosts.length,
      0,
      `Expected zero comment posts on issue ${issueNumber} but recorded ${commentPosts.length}`,
    );
  },
);

Then(
  'the mock GitHub API recorded a comment containing the seeded scenario name from fixture {string}',
  function (_fixturePath: string) {
    return 'pending';
  },
);
