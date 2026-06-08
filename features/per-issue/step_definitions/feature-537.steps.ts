/**
 * BDD step definitions for feature-537.feature
 * hashComputer deep module — framework content hash
 *
 * Steps NOT defined here (already defined elsewhere):
 *   - Given 'the ADW codebase is checked out'      → ensureCronOnEveryEventSteps.ts
 *   - Then  'the ADW TypeScript type-check passes'  → feature-504.steps.ts
 *
 * Fixture approach: each scenario that needs a fixture framework creates a
 * temporary directory. Given steps write files into it; When steps invoke
 * computeFrameworkHash and append the result to recordedHashes. After hook
 * cleans up the temp dirs.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import type { DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeFrameworkHash } from '../../../adws/core/hashComputer.ts';

// ---------------------------------------------------------------------------
// Per-scenario mutable state
// ---------------------------------------------------------------------------

interface Ctx537 {
  fixtureRoot: string | null;
  secondFixtureRoot: string | null;
  recordedHashes: string[];
  lastError: Error | null;
}

const ctx: Ctx537 = {
  fixtureRoot: null,
  secondFixtureRoot: null,
  recordedHashes: [],
  lastError: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdwInitContent(hashInputs: string[]): string {
  const list = hashInputs.map((p) => `  - ${p}`).join('\n');
  return `---\ntarget: false\nhashInputs:\n${list}\n---\n# Fixture adw_init\n`;
}

function writeAdwInit(root: string, hashInputs: string[]): void {
  const dir = path.join(root, '.claude', 'commands');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'adw_init.md'), makeAdwInitContent(hashInputs), 'utf-8');
}

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const absPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf-8');
}

function cleanup(tmpDir: string | null): void {
  if (tmpDir) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Before / After hooks
// ---------------------------------------------------------------------------

Before({ tags: '@adw-537' }, function () {
  ctx.fixtureRoot = null;
  ctx.secondFixtureRoot = null;
  ctx.recordedHashes = [];
  ctx.lastError = null;
});

After({ tags: '@adw-537' }, function () {
  cleanup(ctx.fixtureRoot);
  cleanup(ctx.secondFixtureRoot);
  ctx.fixtureRoot = null;
  ctx.secondFixtureRoot = null;
});

// ---------------------------------------------------------------------------
// Given — primary fixture setup
// ---------------------------------------------------------------------------

Given(
  'a fixture framework whose adw_init spec declares hash inputs:',
  function (dataTable: DataTable) {
    const hashInputs = dataTable.hashes().map((row: Record<string, string>) => row['path']);
    ctx.fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-537-fixture-'));
    writeAdwInit(ctx.fixtureRoot, hashInputs);
  },
);

Given('a fixture framework whose adw_init spec omits the hash inputs frontmatter', function () {
  ctx.fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-537-noinputs-'));
  const dir = path.join(ctx.fixtureRoot, '.claude', 'commands');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'adw_init.md'),
    '---\ntarget: false\n---\n# no hashInputs\n',
    'utf-8',
  );
});

Given(
  'the fixture input file {string} contains {string}',
  function (filePath: string, content: string) {
    assert.ok(ctx.fixtureRoot, 'fixture root must be set before writing input files');
    writeFixtureFile(ctx.fixtureRoot, filePath, content);
  },
);

// ---------------------------------------------------------------------------
// Given — second fixture setup
// ---------------------------------------------------------------------------

Given(
  'a second fixture framework whose adw_init spec declares hash inputs:',
  function (dataTable: DataTable) {
    const hashInputs = dataTable.hashes().map((row: Record<string, string>) => row['path']);
    ctx.secondFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-537-fixture2-'));
    writeAdwInit(ctx.secondFixtureRoot, hashInputs);
  },
);

Given(
  'the fixture input file {string} in the second fixture framework contains {string}',
  function (filePath: string, content: string) {
    assert.ok(ctx.secondFixtureRoot, 'second fixture root must be set');
    writeFixtureFile(ctx.secondFixtureRoot, filePath, content);
  },
);

// ---------------------------------------------------------------------------
// When — hash computation
// ---------------------------------------------------------------------------

When('the framework content hash is computed for the fixture framework', function () {
  assert.ok(ctx.fixtureRoot, 'fixture root must be set');
  const hash = computeFrameworkHash(ctx.fixtureRoot);
  ctx.recordedHashes.push(hash);
});

When(
  'the framework content hash computation is attempted for the fixture framework',
  function () {
    assert.ok(ctx.fixtureRoot, 'fixture root must be set');
    try {
      const hash = computeFrameworkHash(ctx.fixtureRoot);
      ctx.recordedHashes.push(hash);
      ctx.lastError = null;
    } catch (err) {
      ctx.lastError = err instanceof Error ? err : new Error(String(err));
    }
  },
);

When(
  'the hash inputs in the fixture adw_init spec are reordered to:',
  function (dataTable: DataTable) {
    assert.ok(ctx.fixtureRoot, 'fixture root must be set');
    const newOrder = dataTable.hashes().map((row: Record<string, string>) => row['path']);
    writeAdwInit(ctx.fixtureRoot, newOrder);
  },
);

When(
  'the fixture input file {string} is modified by a single byte',
  function (filePath: string) {
    assert.ok(ctx.fixtureRoot, 'fixture root must be set');
    const absPath = path.join(ctx.fixtureRoot, filePath);
    const existing = fs.readFileSync(absPath);
    const modified = Buffer.from(existing);
    modified[0] = modified[0] ^ 0xff;
    fs.writeFileSync(absPath, modified);
  },
);

When('the framework content hash is computed for the second fixture framework', function () {
  assert.ok(ctx.secondFixtureRoot, 'second fixture root must be set');
  const hash = computeFrameworkHash(ctx.secondFixtureRoot);
  ctx.recordedHashes.push(hash);
});

When('the framework content hash is computed for the ADW framework under test', function () {
  const hash = computeFrameworkHash(process.cwd());
  ctx.recordedHashes.push(hash);
});

// ---------------------------------------------------------------------------
// Then — assertions
// ---------------------------------------------------------------------------

Then(
  'the most recent computed hash is a 64-character lowercase hexadecimal SHA256 digest',
  function () {
    assert.ok(ctx.recordedHashes.length > 0, 'Expected at least one recorded hash');
    const last = ctx.recordedHashes[ctx.recordedHashes.length - 1];
    assert.match(
      last,
      /^[0-9a-f]{64}$/,
      `Expected a 64-char lowercase hex SHA256 digest, got: "${last}"`,
    );
  },
);

Then('the recorded hashes are all identical', function () {
  assert.ok(ctx.recordedHashes.length >= 2, 'Expected at least two recorded hashes');
  const first = ctx.recordedHashes[0];
  for (const h of ctx.recordedHashes) {
    assert.strictEqual(h, first, `Expected all hashes to be identical; got "${h}" vs "${first}"`);
  }
});

Then('the recorded hashes are all different', function () {
  assert.ok(ctx.recordedHashes.length >= 2, 'Expected at least two recorded hashes');
  const unique = new Set(ctx.recordedHashes);
  assert.strictEqual(
    unique.size,
    ctx.recordedHashes.length,
    `Expected all hashes to be different but found duplicates: ${JSON.stringify(ctx.recordedHashes)}`,
  );
});

Then(
  'the hash computation fails with an error reporting the absent hash inputs declaration',
  function () {
    assert.ok(ctx.lastError, 'Expected an error to have been thrown');
    assert.ok(
      ctx.lastError.message.includes('hashInputs'),
      `Expected error message to mention "hashInputs", got: "${ctx.lastError.message}"`,
    );
  },
);

Then(
  'the hash computation fails with an error that names the missing input file {string}',
  function (missingFile: string) {
    assert.ok(ctx.lastError, 'Expected an error to have been thrown');
    assert.ok(
      ctx.lastError.message.includes(missingFile),
      `Expected error message to mention "${missingFile}", got: "${ctx.lastError.message}"`,
    );
  },
);
