import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── Context-only When steps (new patterns not in other step files) ─────────────

When('searching for the {string} type definition', function (_type: string) {
  // Context only — assertions happen in Then steps
});

When('searching for export statements', function () {
  // Context only — assertions happen in Then steps
});

When('searching for export statements from {string}', function (_path: string) {
  // Context only — assertions happen in Then steps
});

When(
  'searching for {string}, {string}, {string}, and {string}',
  function (s1: string, s2: string, s3: string, s4: string) {
    (this as Record<string, unknown>).__storedSymbols = [s1, s2, s3, s4];
  },
);

// ── Context-only Given steps ──────────────────────────────────────────────────

Given('all legacy E2E functions, files, and config entries have been deleted', function () {
  // Context only — verified by the specific assertion steps
});

Given('all test files under {string} are scanned', function (dir: string) {
  const fullDir = join(ROOT, dir);
  function collectTs(d: string): string[] {
    const entries = readdirSync(d, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) results.push(...collectTs(full));
      else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) results.push(full);
    }
    return results;
  }
  const files = collectTs(fullDir);
  const combined = files.map(f => readFileSync(f, 'utf-8')).join('\n');
  sharedCtx.fileContent = combined;
  sharedCtx.filePath = `${dir}/**/*.test.ts`;
});

Given('all markdown files under {string} are scanned', function (dir: string) {
  const fullDir = join(ROOT, dir);
  function collectMd(d: string): string[] {
    const entries = readdirSync(d, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) results.push(...collectMd(full));
      else if (entry.name.endsWith('.md')) results.push(full);
    }
    return results;
  }
  const files = collectMd(fullDir);
  const combined = files.map(f => readFileSync(f, 'utf-8')).join('\n');
  sharedCtx.fileContent = combined;
  sharedCtx.filePath = `${dir}/**/*.md`;
});

// ── "Is/is not" assertion steps (new patterns) ───────────────────────────────

Then('{string} is still defined in {string}', function (symbol: string, _filePath: string) {
  assert.ok(
    sharedCtx.fileContent.includes(symbol),
    `Expected "${symbol}" to still be defined in "${sharedCtx.filePath}"`,
  );
});

Then('{string} is still exported from {string}', function (symbol: string, _filePath: string) {
  assert.ok(
    sharedCtx.fileContent.includes(symbol),
    `Expected "${symbol}" to still be exported from "${sharedCtx.filePath}"`,
  );
});

// ── Export statement assertions ───────────────────────────────────────────────

Then('{string} does not appear in any export statement', function (symbol: string) {
  const exportLines = sharedCtx.fileContent
    .split('\n')
    .filter((line: string) => line.includes('export'));
  const appearsInExport = exportLines.some((line: string) => line.includes(symbol));
  assert.ok(
    !appearsInExport,
    `Expected "${symbol}" not to appear in any export statement in "${sharedCtx.filePath}"`,
  );
});

Then('{string} type does not appear in any export statement', function (symbol: string) {
  const exportLines = sharedCtx.fileContent
    .split('\n')
    .filter((line: string) => line.includes('export'));
  const appearsInExport = exportLines.some((line: string) => line.includes(symbol));
  assert.ok(
    !appearsInExport,
    `Expected "${symbol}" type not to appear in any export statement in "${sharedCtx.filePath}"`,
  );
});

Then('{string} is still re-exported from the agents barrel', function (symbol: string) {
  assert.ok(
    sharedCtx.fileContent.includes(symbol),
    `Expected "${symbol}" to be re-exported from "${sharedCtx.filePath}"`,
  );
});

Then('no export block from {string} exists', function (fromPath: string) {
  const escaped = fromPath.replace(/\./g, '\\.').replace(/\//g, '\\/');
  const pattern = new RegExp(`from\\s+['"]${escaped}['"]`);
  assert.ok(
    !pattern.test(sharedCtx.fileContent),
    `Expected no export block from "${fromPath}" in "${sharedCtx.filePath}"`,
  );
});

// ── "No remaining references" assertions ─────────────────────────────────────

Then('no file contains a call to or import of {string}', function (symbol: string) {
  function collectTs(d: string): string[] {
    const entries = readdirSync(d, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) results.push(...collectTs(full));
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) results.push(full);
    }
    return results;
  }
  const files = collectTs(join(ROOT, 'adws'));
  const filesWithSymbol = files.filter(f => readFileSync(f, 'utf-8').includes(symbol));
  assert.strictEqual(
    filesWithSymbol.length,
    0,
    `Expected no file to reference "${symbol}" but found: ${filesWithSymbol.map(f => f.replace(ROOT + '/', '')).join(', ')}`,
  );
});

Then('no file references any of those symbols', function (this: Record<string, unknown>) {
  const symbols = (this.__storedSymbols ?? []) as string[];
  for (const symbol of symbols) {
    assert.ok(
      !sharedCtx.fileContent.includes(symbol),
      `Expected no file to reference "${symbol}" in "${sharedCtx.filePath}"`,
    );
  }
});

// ── Directory convention assertions ──────────────────────────────────────────

Then('no file references the {string} directory path', function (dirPath: string) {
  function collectTs(d: string): string[] {
    const entries = readdirSync(d, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) results.push(...collectTs(full));
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) results.push(full);
    }
    return results;
  }
  const files = collectTs(join(ROOT, 'adws'));
  const filesWithPath = files.filter(f => readFileSync(f, 'utf-8').includes(dirPath));
  assert.strictEqual(
    filesWithPath.length,
    0,
    `Expected no TypeScript file to reference "${dirPath}" but found: ${filesWithPath.map(f => f.replace(ROOT + '/', '')).join(', ')}`,
  );
});

Then('no command file references the {string} directory convention', function (dirPath: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(dirPath),
    `Expected no command file to reference "${dirPath}" in "${sharedCtx.filePath}"`,
  );
});

// ── Test/lint execution assertions ────────────────────────────────────────────

Then('all tests pass', function (this: Record<string, unknown>) {
  const result = this.__commandResult as ReturnType<typeof spawnSync>;
  assert.strictEqual(
    result.status,
    0,
    `Expected tests to pass (exit code 0) but got ${result.status}.\nStdout: ${result.stdout}\nStderr: ${result.stderr}`,
  );
});

Then('lint exits with code 0', function (this: Record<string, unknown>) {
  const result = this.__commandResult as ReturnType<typeof spawnSync>;
  assert.strictEqual(
    result.status,
    0,
    `Expected lint to pass (exit code 0) but got ${result.status}.\nStdout: ${result.stdout}\nStderr: ${result.stderr}`,
  );
});

// ── Config test assertions ────────────────────────────────────────────────────

Then('no test file asserts against the {string} field', function (field: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(field),
    `Expected no test file to assert against field "${field}" in "${sharedCtx.filePath}"`,
  );
});

Then('existing config-related tests still pass', function () {
  // Pass-through: verified by the bun run test step
});
