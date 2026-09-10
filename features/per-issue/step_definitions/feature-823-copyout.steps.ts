/**
 * feature-823.feature step definitions — §7 the extraction gate: both
 * packages copied side by side, imported. Entry file: feature-823.steps.ts
 * (state, Before/After hooks, splitRepo).
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, type Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { wcopy } from './feature-823.steps.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GITCONTEXT_SRC = path.join(REPO_ROOT, 'adws', 'gitContext');
const PROVIDERS_SRC = path.join(REPO_ROOT, 'adws', 'providers');

/** Modelled on feature-797.steps.ts's copyDirExcluding — a local copy, since that one is not exported. */
function copyDirEntry(entry: Dirent, src: string, dest: string, excludeDirNames: ReadonlySet<string>): void {
  const srcPath = path.join(src, entry.name);
  const destPath = path.join(dest, entry.name);
  if (entry.isFile()) {
    copyFileSync(srcPath, destPath);
    return;
  }
  if (!entry.isDirectory() || excludeDirNames.has(entry.name)) return;
  copyDirExcluding(srcPath, destPath, excludeDirNames);
}

function copyDirExcluding(src: string, dest: string, excludeDirNames: ReadonlySet<string>): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    copyDirEntry(entry, src, dest, excludeDirNames);
  }
}

Given('the git context and provider packages are copied side by side into an empty directory', function () {
  const parent = mkdtempSync(path.join(tmpdir(), 'adw-823-isolated-'));
  wcopy.tempDir = parent;
  copyDirExcluding(GITCONTEXT_SRC, path.join(parent, 'gitContext'), new Set(['__tests__']));
  copyDirExcluding(PROVIDERS_SRC, path.join(parent, 'providers'), new Set(['__tests__']));
});

When('the copied provider package is imported as its own entry point', async function () {
  assert.ok(wcopy.tempDir, 'Expected the packages to have been copied first');
  const entryUrl = pathToFileURL(path.join(wcopy.tempDir, 'providers', 'index.ts')).href;
  try {
    await import(entryUrl);
    wcopy.imported = true;
    wcopy.importError = null;
  } catch (err) {
    wcopy.imported = false;
    wcopy.importError = err as Error;
  }
});

Then('the import of the copied packages succeeds', function () {
  assert.strictEqual(
    wcopy.importError, null,
    `Expected the copied packages to import cleanly, got: ${wcopy.importError?.stack ?? wcopy.importError}`,
  );
  assert.strictEqual(wcopy.imported, true);
});

Then('the copied packages resolved no module outside their own directories', function () {
  assert.strictEqual(wcopy.importError, null, 'Expected no import error (a reach outside the copy would fail to resolve)');
  assert.ok(wcopy.tempDir, 'Expected a temp directory to have been set up');
  const topLevel = readdirSync(wcopy.tempDir).sort();
  assert.deepStrictEqual(
    topLevel, ['gitContext', 'providers'],
    `Expected only the copied packages on disk, found: ${topLevel.join(', ')}`,
  );
});
