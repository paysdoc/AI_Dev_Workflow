/**
 * BDD step definitions for feature-538.feature
 * adwVersion deep module — read and write a target repo's .adw-version hash file
 *
 * Steps NOT defined here (already defined elsewhere):
 *   - Given 'the ADW codebase is checked out'      → ensureCronOnEveryEventSteps.ts
 *   - Then  'the ADW TypeScript type-check passes'  → feature-504.steps.ts
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readAdwVersion, writeAdwVersion } from '../../../adws/core/adwVersion.ts';

// ---------------------------------------------------------------------------
// Per-scenario mutable state
// ---------------------------------------------------------------------------

interface Ctx538 {
  tmpDir: string;
  readResult: string | null | undefined;
}

const ctx: Ctx538 = {
  tmpDir: '',
  readResult: undefined,
};

// ---------------------------------------------------------------------------
// Before / After hooks — manage per-scenario temp worktree directory
// ---------------------------------------------------------------------------

Before({ tags: '@adw-538' }, function () {
  ctx.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-538-'));
  ctx.readResult = undefined;
});

After({ tags: '@adw-538' }, function () {
  if (ctx.tmpDir) {
    fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
    ctx.tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// Given — worktree fixture setup
// ---------------------------------------------------------------------------

Given(
  'a target worktree whose {string} file contains the hash {string} followed by a single trailing newline',
  function (fileName: string, hash: string) {
    void fileName;
    fs.writeFileSync(path.join(ctx.tmpDir, '.adw-version'), `${hash}\n`, 'utf-8');
  },
);

Given(
  'a target worktree that has no {string} file',
  function (_fileName: string) {
    // temp dir is already created with no .adw-version — nothing to do
  },
);

Given(
  'a target worktree with no {string} file',
  function (_fileName: string) {
    // temp dir is already created with no .adw-version — nothing to do
  },
);

Given(
  'a target worktree whose {string} file contains the hash {string} followed by trailing spaces and a newline',
  function (fileName: string, hash: string) {
    void fileName;
    fs.writeFileSync(path.join(ctx.tmpDir, '.adw-version'), `${hash}  \n`, 'utf-8');
  },
);

Given(
  'a target worktree whose {string} file contains the hash {string} followed by several blank lines',
  function (fileName: string, hash: string) {
    void fileName;
    fs.writeFileSync(path.join(ctx.tmpDir, '.adw-version'), `${hash}\n\n\n`, 'utf-8');
  },
);

Given(
  'a target worktree whose {string} file contains the hash {string} with no trailing newline',
  function (fileName: string, hash: string) {
    void fileName;
    fs.writeFileSync(path.join(ctx.tmpDir, '.adw-version'), hash, 'utf-8');
  },
);

Given(
  'a target worktree whose {string} file already contains the hash {string} followed by a single trailing newline',
  function (fileName: string, hash: string) {
    void fileName;
    fs.writeFileSync(path.join(ctx.tmpDir, '.adw-version'), `${hash}\n`, 'utf-8');
  },
);

// ---------------------------------------------------------------------------
// When — function invocations
// ---------------------------------------------------------------------------

When('readAdwVersion is called on that worktree', function () {
  ctx.readResult = readAdwVersion(ctx.tmpDir);
});

When(
  'writeAdwVersion is called on that worktree with the hash {string}',
  function (hash: string) {
    writeAdwVersion(ctx.tmpDir, hash);
  },
);

// ---------------------------------------------------------------------------
// Then — assertions on return values and on-disk artefacts
// ---------------------------------------------------------------------------

Then('readAdwVersion returns {string}', function (expected: string) {
  assert.strictEqual(
    ctx.readResult,
    expected,
    `Expected readAdwVersion to return "${expected}" but got ${JSON.stringify(ctx.readResult)}`,
  );
});

Then('readAdwVersion returns null', function () {
  assert.strictEqual(
    ctx.readResult,
    null,
    `Expected readAdwVersion to return null but got ${JSON.stringify(ctx.readResult)}`,
  );
});

Then(
  'the {string} artefact in that worktree contains exactly the hash {string} followed by a single newline',
  function (fileName: string, hash: string) {
    void fileName;
    const raw = fs.readFileSync(path.join(ctx.tmpDir, '.adw-version'), 'utf-8');
    assert.strictEqual(
      raw,
      `${hash}\n`,
      `Expected .adw-version to contain exactly "${hash}\\n" but got ${JSON.stringify(raw)}`,
    );
  },
);
