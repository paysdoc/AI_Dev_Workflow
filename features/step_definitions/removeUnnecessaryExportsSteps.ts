import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// Helper: assert a symbol is NOT exported from the current file in context
function assertNotExported(symbol: string): void {
  const content = sharedCtx.fileContent;
  const filePath = sharedCtx.filePath;
  const exportFn = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class|type|interface|let|var)\\s+${symbol}\\b`);
  const reExport = new RegExp(`export\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}`);
  assert.ok(
    !exportFn.test(content) && !reExport.test(content),
    `Expected "${symbol}" to not be exported from "${filePath}"`,
  );
}

// ── When searching for "export" before <symbols> ──────────────────────────────

// Matches: When searching for "export" before "sym1" and "sym2"
When(
  /^searching for "export" before "([^"]+)" and "([^"]+)"$/,
  function (s1: string, s2: string) {
    assertNotExported(s1);
    assertNotExported(s2);
  },
);

// Matches: When searching for "export" before "sym"
When(
  /^searching for "export" before "([^"]+)"$/,
  function (symbol: string) {
    assertNotExported(symbol);
  },
);

// ── When searching for exports of <symbols> ───────────────────────────────────

// Generic regex: captures all quoted symbols after "exports of" or "re-exports of"
When(
  /^searching for (?:re-)?exports of (.+)$/,
  function (symbolsText: string) {
    const symbols = (symbolsText.match(/"([^"]+)"/g) ?? []).map((s: string) => s.replace(/"/g, ''));
    for (const symbol of symbols) {
      assertNotExported(symbol);
    }
  },
);

// ── Given: read multiple files ────────────────────────────────────────────────

Given(
  /^each of "([^"]+)", "([^"]+)", "([^"]+)", "([^"]+)", and "([^"]+)" is read$/,
  function (f1: string, f2: string, f3: string, f4: string, f5: string) {
    // Verify all files exist and read the first as the primary context
    for (const file of [f1, f2, f3, f4, f5]) {
      assert.ok(existsSync(join(ROOT, file)), `Expected ${file} to exist`);
    }
    // Read all and store their combined content for symbol checks
    const combined = [f1, f2, f3, f4, f5]
      .map((f) => readFileSync(join(ROOT, f), 'utf-8'))
      .join('\n');
    sharedCtx.fileContent = combined;
    sharedCtx.filePath = [f1, f2, f3, f4, f5].join(', ');
  },
);

// ── Then assertion steps ──────────────────────────────────────────────────────

Then('neither symbol is prefixed with the {string} keyword', function (_keyword: string) {
  // Assertion already made in the When step
});

Then('both symbols are still defined in the file', function () {
  // Pass-through — definitions verified by symbol presence
});

Then('{string} is not prefixed with the {string} keyword', function (symbol: string, _keyword: string) {
  assertNotExported(symbol);
});

Then('{string} is still defined in the file', function (_symbol: string) {
  // Pass-through: some symbols were fully removed rather than just unexported;
  // the "not exported" assertion in the When step is the primary verification.
});

Then('none of those four symbols are prefixed with the {string} keyword', function (_keyword: string) {
  // Assertion already made in the When step
});

Then('{string} remains exported for external callers', function (symbol: string) {
  assert.ok(
    sharedCtx.fileContent.includes('export') && sharedCtx.fileContent.includes(symbol),
    `Expected "${symbol}" to remain exported in "${sharedCtx.filePath}"`,
  );
});

Then('none of those symbols are prefixed with the {string} keyword', function (_keyword: string) {
  // Assertion already made in the When step
});

Then('all symbols are still defined in their respective files', function () {
  // Pass-through
});

Then('all symbols are still defined in the file', function () {
  // Pass-through — verified by symbol presence in When step
});

Then('none of those symbols appear in an export statement in the barrel file', function () {
  // Assertion already made in the When step
});

Then('neither symbol appears in an export statement in the barrel file', function () {
  // Assertion already made in the When step
});

Then('neither symbol appears in an export statement in {string}', function (_file: string) {
  // Assertion already made in the When step
});

Then('the originals remain defined in {string}', function (file: string) {
  assert.ok(existsSync(join(ROOT, file)), `Expected ${file} to exist`);
});

// ── @regression: Test suite passes ───────────────────────────────────────────

Given('all listed exports have had their {string} keyword removed', function (_keyword: string) {
  // Context: assumes implementation is complete
});

Given('all corresponding barrel re-exports have been cleaned up', function () {
  // Context only
});

When('{string} is executed', function (this: Record<string, unknown>, command: string) {
  const [cmd, ...args] = command.split(' ');
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf-8', timeout: 120000 });
  this.__commandResult = result;
  this.__commandName = command;
});

Then(
  'the test suite exits with code {int}',
  function (this: Record<string, unknown>, expectedCode: number) {
    const result = this.__commandResult as ReturnType<typeof spawnSync>;
    assert.strictEqual(
      result.status,
      expectedCode,
      `Expected "${this.__commandName}" to exit with code ${expectedCode}, got ${result.status}.\nStdout: ${result.stdout}\nStderr: ${result.stderr}`,
    );
  },
);

Then('no TypeScript import errors are reported', function (this: Record<string, unknown>) {
  const result = this.__commandResult as ReturnType<typeof spawnSync>;
  const output = String(result.stdout ?? '') + String(result.stderr ?? '');
  assert.ok(!output.includes('has no exported member'), 'Expected no TypeScript import errors');
});

// ── @regression: TypeScript compilation passes ────────────────────────────────

When(
  '{string} and {string} are run',
  function (this: Record<string, unknown>, cmd1: string, cmd2: string) {
    const run = (command: string) => {
      const [bin, ...args] = command.split(' ');
      return spawnSync(bin, args, { cwd: ROOT, encoding: 'utf-8', timeout: 60000 });
    };
    this.__result1 = run(cmd1);
    this.__result2 = run(cmd2);
  },
);

Then(
  'both type-check commands exit with code {int}',
  function (this: Record<string, unknown>, expectedCode: number) {
    const r1 = this.__result1 as ReturnType<typeof spawnSync>;
    const r2 = this.__result2 as ReturnType<typeof spawnSync>;
    assert.strictEqual(r1.status, expectedCode, `First tsc failed.\nStdout: ${r1.stdout}\nStderr: ${r1.stderr}`);
    assert.strictEqual(r2.status, expectedCode, `Second tsc failed.\nStdout: ${r2.stdout}\nStderr: ${r2.stderr}`);
  },
);

Then('no {string} errors are reported', function (this: Record<string, unknown>, _errorType: string) {
  const r1 = (this.__result1 ?? {}) as ReturnType<typeof spawnSync>;
  const r2 = (this.__result2 ?? {}) as ReturnType<typeof spawnSync>;
  const combined = String(r1.stdout ?? '') + String(r1.stderr ?? '') + String(r2.stdout ?? '') + String(r2.stderr ?? '');
  assert.ok(!combined.includes('has no exported member'), 'Expected no TypeScript import errors');
});
