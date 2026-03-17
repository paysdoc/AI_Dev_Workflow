import { Given, When, Then } from '@cucumber/cucumber';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();

// Helper: recursively find files matching a regex (excluding node_modules)
function findFiles(dir: string, pattern: RegExp, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      findFiles(fullPath, pattern, results);
    } else if (pattern.test(entry)) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Background ─────────────────────────────────────────────────────────────────

Given('the repository is at the current working directory', function () {
  assert.ok(existsSync(join(ROOT, 'adws')), 'Expected adws/ directory to exist');
  assert.ok(existsSync(join(ROOT, 'package.json')), 'Expected package.json to exist');
});

// ── Scenario 1: All *.test.ts files are deleted ────────────────────────────────

Given(
  'the repository contains unit test files under {string}, {string}, and {string}',
  function (_d1: string, _d2: string, _d3: string) {
    // Context-only: unit test files were previously present
  },
);

When('all unit test files are deleted as part of issue {int}', function (_issueNum: number) {
  // Context-only: deletion already happened
});

Then('no {string} files exist anywhere in the repository', function (globPattern: string) {
  // Convert glob pattern (e.g. "*.test.ts") to a suffix regex
  const suffix = globPattern.replace(/^\*/, '');
  const escaped = suffix.replace(/\./g, '\\.');
  const pattern = new RegExp(escaped + '$');
  const found = findFiles(ROOT, pattern);
  assert.strictEqual(
    found.length,
    0,
    `Expected no ${globPattern} files, but found:\n${found.join('\n')}`,
  );
});

Then('the {string} directory does not exist', function (dirPath: string) {
  assert.ok(
    !existsSync(join(ROOT, dirPath)),
    `Expected directory "${dirPath}" to not exist`,
  );
});

// ── Scenario 2: vitest.config.ts is removed ────────────────────────────────────

Given('{string} exists at the project root', function (_fileName: string) {
  // Context-only: file was previously present
});

When('the Vitest configuration file is deleted', function () {
  // Context-only: deletion already happened
});

Then('{string} does not exist in the repository', function (fileName: string) {
  assert.ok(
    !existsSync(join(ROOT, fileName)),
    `Expected "${fileName}" to not exist in the repository`,
  );
});

// ── Scenario 3: vitest dependency is removed from package.json ─────────────────

Given('{string} lists {string} under devDependencies', function (_file: string, _dep: string) {
  // Context-only: dependency was previously listed
});

When(
  'the vitest package and related test dependencies are removed from {string}',
  function (_file: string) {
    // Context-only: removal already happened
  },
);

Then(
  '{string} does not contain {string} as a dependency',
  function (file: string, dep: string) {
    const fullPath = join(ROOT, file);
    assert.ok(existsSync(fullPath), `Expected ${file} to exist`);
    const pkg = JSON.parse(readFileSync(fullPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const inDeps = pkg.dependencies != null && dep in pkg.dependencies;
    const inDevDeps = pkg.devDependencies != null && dep in pkg.devDependencies;
    assert.ok(
      !inDeps && !inDevDeps,
      `Expected "${dep}" to not be in dependencies or devDependencies of "${file}"`,
    );
  },
);

Then('{string} does not reference {string}', function (file: string, term: string) {
  const fullPath = join(ROOT, file);
  assert.ok(existsSync(fullPath), `Expected ${file} to exist`);
  const content = readFileSync(fullPath, 'utf-8');
  assert.ok(!content.includes(term), `Expected "${file}" to not reference "${term}"`);
});

// ── Scenario 4: test scripts are removed from package.json ────────────────────

Given(
  '{string} contains a {string} script and a {string} script',
  function (_file: string, _s1: string, _s2: string) {
    // Context-only: scripts were previously present
  },
);

When('the test scripts are removed from {string}', function (_file: string) {
  // Context-only: removal already happened
});

Then(
  '{string} does not contain a {string} script entry',
  function (file: string, scriptName: string) {
    const fullPath = join(ROOT, file);
    assert.ok(existsSync(fullPath), `Expected ${file} to exist`);
    const pkg = JSON.parse(readFileSync(fullPath, 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    assert.ok(
      !(pkg.scripts != null && scriptName in pkg.scripts),
      `Expected "${scriptName}" to not be in scripts of "${file}"`,
    );
  },
);

// ── Scenario 5: TypeScript compilation succeeds ────────────────────────────────

Given('all unit test files and {string} have been removed', function (_fileName: string) {
  // Context-only: removal already happened
});

Then(
  'no {string} or missing-type errors are reported for removed test files',
  function (this: Record<string, unknown>, errorType: string) {
    const r1 = (this.__result1 ?? {}) as { stdout?: unknown; stderr?: unknown };
    const r2 = (this.__result2 ?? {}) as { stdout?: unknown; stderr?: unknown };
    const combined =
      String(r1.stdout ?? '') +
      String(r1.stderr ?? '') +
      String(r2.stdout ?? '') +
      String(r2.stderr ?? '');
    assert.ok(!combined.includes('Cannot find module'), 'Expected no "Cannot find module" errors');
    assert.ok(!combined.includes(errorType), `Expected no "${errorType}" errors`);
  },
);
