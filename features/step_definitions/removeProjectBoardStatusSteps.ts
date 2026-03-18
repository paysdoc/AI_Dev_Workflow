import { Given, When, Then } from '@cucumber/cucumber';
import { existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();

// ── Context-only Given ────────────────────────────────────────────────────────

Given('all project board status management code has been removed', function () {
  // Context only — implementation is verified by the TypeScript compilation step
});

// ── File non-existence check ──────────────────────────────────────────────────

When(
  'the filesystem is checked for {string}',
  function (this: Record<string, string>, filePath: string) {
    this.checkedFilePath = filePath;
  },
);

Then('the file does not exist', function (this: Record<string, string>) {
  const fullPath = join(ROOT, this.checkedFilePath);
  assert.ok(!existsSync(fullPath), `Expected file to not exist: ${this.checkedFilePath}`);
});
