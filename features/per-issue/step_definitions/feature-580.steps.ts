/**
 * BDD step definitions for feature-580.feature
 * Screenshot harvest to R2 + inline proof PR comment.
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'   → ensureCronOnEveryEventSteps.ts
 *  - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts
 *
 * Novel phrases introduced here:
 *  - Given 'an empty proof directory'
 *  - Given 'the proof directory contains an image at {string}'
 *  - Given 'the proof directory contains a non-image file at {string}'
 *  - When  'the proof artifacts are harvested from the proof directory'
 *  - Then  'the harvested image set is empty'
 *  - Then  'the harvested image count is {int}'
 *  - Then  'the harvested image set includes an image named {string}'
 *  - Then  'the harvested image set excludes a file named {string}'
 *  - Given 'a proof summary of {int} passed and {int} failed scenarios'
 *  - Given 'the scenario {string} captured the screenshot {string}'
 *  - Given 'the proof run captured no screenshots'
 *  - When  'the proof comment is composed'
 *  - Then  'the composed proof comment includes a pass/fail summary of {int} passed and {int} failed'
 *  - Then  'the composed proof comment inlines an image embed of {string}'
 *  - Then  'the composed proof comment has a collapsible section titled {string}'
 *  - Then  'the composed proof comment provides a raw R2 fallback link to {string}'
 *  - Then  'the composed proof comment contains no image embeds'
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { harvestProofArtifacts } from '../../../adws/proof/proofArtifactHarvester.ts';
import { formatPrProofComment } from '../../../adws/proof/prProofPublisher.ts';
import type { ProofArtifact } from '../../../adws/proof/types.ts';
import type { TagProofResultLike, UploadedArtifact } from '../../../adws/proof/types.ts';

// ── Shared context ────────────────────────────────────────────────────────────

const ctx: {
  proofDir: string | null;
  harvestedArtifacts: ProofArtifact[];
  tagResults: TagProofResultLike[];
  uploaded: UploadedArtifact[];
  composedComment: string | null;
  tmpDirs: string[];
} = {
  proofDir: null,
  harvestedArtifacts: [],
  tagResults: [],
  uploaded: [],
  composedComment: null,
  tmpDirs: [],
};

After(function () {
  for (const dir of ctx.tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  ctx.proofDir = null;
  ctx.harvestedArtifacts = [];
  ctx.tagResults = [];
  ctx.uploaded = [];
  ctx.composedComment = null;
});

// ── Harvest step definitions (§1–§3) ─────────────────────────────────────────

Given('an empty proof directory', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-580-'));
  ctx.tmpDirs.push(dir);
  ctx.proofDir = dir;
});

Given('the proof directory contains an image at {string}', function (relPath: string) {
  if (!ctx.proofDir) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-580-'));
    ctx.tmpDirs.push(dir);
    ctx.proofDir = dir;
  }
  const absPath = path.join(ctx.proofDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, '');
});

Given('the proof directory contains a non-image file at {string}', function (relPath: string) {
  if (!ctx.proofDir) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-580-'));
    ctx.tmpDirs.push(dir);
    ctx.proofDir = dir;
  }
  const absPath = path.join(ctx.proofDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, '');
});

When('the proof artifacts are harvested from the proof directory', function () {
  assert.ok(ctx.proofDir !== null, 'Expected proofDir to be set');
  ctx.harvestedArtifacts = harvestProofArtifacts(ctx.proofDir);
});

Then('the harvested image set is empty', function () {
  assert.strictEqual(ctx.harvestedArtifacts.length, 0);
});

Then('the harvested image count is {int}', function (expected: number) {
  assert.strictEqual(ctx.harvestedArtifacts.length, expected);
});

Then('the harvested image set includes an image named {string}', function (name: string) {
  const names = ctx.harvestedArtifacts.map(a => path.basename(a.relPath));
  assert.ok(names.includes(name), `Expected harvested set to include "${name}", got: [${names.join(', ')}]`);
});

Then('the harvested image set excludes a file named {string}', function (name: string) {
  const names = ctx.harvestedArtifacts.map(a => path.basename(a.relPath));
  assert.ok(!names.includes(name), `Expected harvested set to exclude "${name}", but it was found`);
});

// ── Publish step definitions (§4–§8) ─────────────────────────────────────────

Given('a proof summary of {int} passed and {int} failed scenarios', function (passed: number, failed: number) {
  const total = passed + failed;
  ctx.tagResults = [
    {
      resolvedTag: '@adw-580',
      severity: 'blocker',
      passed: failed === 0,
      skipped: false,
      counts: { total, passed, failed },
    },
  ];
});

Given('the scenario {string} captured the screenshot {string}', function (scenario: string, url: string) {
  const fileName = path.basename(url);
  ctx.uploaded.push({ scenario, url, fileName });
});

Given('the proof run captured no screenshots', function () {
  ctx.uploaded = [];
});

When('the proof comment is composed', function () {
  ctx.composedComment = formatPrProofComment({
    tagResults: ctx.tagResults,
    uploaded: ctx.uploaded,
    r2Configured: true,
  });
});

Then(
  'the composed proof comment includes a pass\\/fail summary of {int} passed and {int} failed',
  function (passed: number, failed: number) {
    assert.ok(ctx.composedComment !== null, 'Expected composedComment to be set');
    assert.ok(
      ctx.composedComment.includes(`${passed} passed, ${failed} failed`),
      `Expected comment to contain "${passed} passed, ${failed} failed".\nComment:\n${ctx.composedComment}`,
    );
  },
);

Then('the composed proof comment inlines an image embed of {string}', function (url: string) {
  assert.ok(ctx.composedComment !== null, 'Expected composedComment to be set');
  const embedPattern = `](${url})`;
  assert.ok(
    ctx.composedComment.includes(embedPattern),
    `Expected comment to contain an image embed for "${url}".\nComment:\n${ctx.composedComment}`,
  );
});

Then('the composed proof comment has a collapsible section titled {string}', function (title: string) {
  assert.ok(ctx.composedComment !== null, 'Expected composedComment to be set');
  assert.ok(
    ctx.composedComment.includes(`<summary>${title}`),
    `Expected comment to have a <details> section titled "${title}".\nComment:\n${ctx.composedComment}`,
  );
});

Then('the composed proof comment provides a raw R2 fallback link to {string}', function (url: string) {
  assert.ok(ctx.composedComment !== null, 'Expected composedComment to be set');
  assert.ok(
    ctx.composedComment.includes(url),
    `Expected comment to contain raw fallback link "${url}".\nComment:\n${ctx.composedComment}`,
  );
});

Then('the composed proof comment contains no image embeds', function () {
  assert.ok(ctx.composedComment !== null, 'Expected composedComment to be set');
  assert.ok(
    !ctx.composedComment.includes('!['),
    `Expected comment to contain no image embeds but found one.\nComment:\n${ctx.composedComment}`,
  );
});
