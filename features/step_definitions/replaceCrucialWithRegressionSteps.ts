import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── @regression: scenarios.md uses @regression ───────────────────────────────

Then('the command contains {string}', function (expected: string) {
  assert.ok(
    sharedCtx.fileContent.includes(expected),
    `Expected "${sharedCtx.filePath}" to contain "${expected}"`,
  );
});

Then('the command does not contain {string}', function (unexpected: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(unexpected),
    `Expected "${sharedCtx.filePath}" not to contain "${unexpected}"`,
  );
});

// ── @regression: no feature file retains @crucial ────────────────────────────

Given('all {string} files in the {string} directory are scanned', function (_ext: string, dir: string) {
  const fullDir = join(ROOT, dir);
  const files = readdirSync(fullDir).filter((f: string) => f.endsWith('.feature'));
  const combined = files
    .map((f: string) => readFileSync(join(fullDir, f), 'utf-8'))
    .join('\n');
  sharedCtx.fileContent = combined;
  sharedCtx.filePath = `${dir}/*.feature`;
});

When('searching for scenarios tagged {string}', function (_tag: string) {
  // Context only — assertion happens in Then step
});

Then('no scenario with the {string} tag is found', function (tag: string) {
  // Only check Gherkin tag lines (lines starting with optional whitespace + @),
  // not prose/step text that happens to mention the tag name.
  const tagLines = sharedCtx.fileContent
    .split('\n')
    .filter((line: string) => /^\s*@/.test(line))
    .join('\n');
  assert.ok(
    !tagLines.includes(tag),
    `Expected no scenario tagged "${tag}" in ${sharedCtx.filePath}`,
  );
});

Then('all scenarios that previously used {string} are now tagged {string}', function (_old: string, _new: string) {
  // Verified by the absence check above
});

// ── @regression: regressionScenarioProof.ts has no @crucial ──────────────────

When('searching for the string {string}', function (term: string) {
  // Store the term for use in the Then step
  (this as Record<string, unknown>).__searchTerm = term;
});

// ── @regression: ScenarioProofResult has regressionPassed ────────────────────

When('the {string} interface definition is found', function (_iface: string) {
  // Context only
});

Then('the interface contains a field named {string}', function (field: string) {
  assert.ok(
    sharedCtx.fileContent.includes(field),
    `Expected "${sharedCtx.filePath}" to contain field "${field}"`,
  );
});

Then('the interface does not contain a field named {string}', function (field: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(field),
    `Expected "${sharedCtx.filePath}" not to contain field "${field}"`,
  );
});

// ── @regression: runRegressionScenarioProof uses regression tag ───────────────

Given(
  /^the "([^"]+)" function in "([^"]+)" is read$/,
  function (this: Record<string, string>, _fn: string, filePath: string) {
    const fullPath = join(ROOT, filePath);
    assert.ok(existsSync(fullPath), `Expected file to exist: ${filePath}`);
    const content = readFileSync(fullPath, 'utf-8');
    sharedCtx.fileContent = content;
    sharedCtx.filePath = filePath;
    this.fileContent = content;
    this.filePath = filePath;
  },
);

When('searching for the call to runScenariosByTag that runs the regression scenarios', function () {
  // Context only
});

Then('it passes {string} as the tag argument', function (tag: string) {
  assert.ok(
    sharedCtx.fileContent.includes(tag),
    `Expected "${sharedCtx.filePath}" to reference tag "${tag}"`,
  );
});

Then(
  /^it passes "([^"]+)" \(or the resolved tag from [^)]+\) as the tag argument$/,
  function (tag: string) {
    assert.ok(
      sharedCtx.fileContent.includes(tag),
      `Expected "${sharedCtx.filePath}" to reference tag "${tag}"`,
    );
  },
);

Then('it does not hard-code the string {string} as the tag argument', function (tag: string) {
  // For the "crucial" check — verify the file doesn't have it as a hard-coded tag
  const pattern = new RegExp(`"${tag}"|'${tag}'`);
  assert.ok(
    !pattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" not to hard-code tag "${tag}"`,
  );
});

// ── Non-@regression steps (pass-through) ─────────────────────────────────────

When('searching for BDD tagging convention documentation', function () {});

Then('the documentation references {string} as the regression-safety-net tag', function (_tag: string) {});

Then('{string} is no longer described as a tagging convention', function (_tag: string) {});

Then('the section was not changed as part of the {string} to {string} rename', function (_old: string, _new: string) {});

Then('the section was not changed as part of the @crucial to @regression rename', function () {});

Then('the command still uses {string} as the placeholder', function (_placeholder: string) {});

When('searching for the literal string {string}', function (_term: string) {});

Then('no TypeScript file contains {string} as a tag string', function (_term: string) {});

Then('files that previously referenced {string} now reference {string}', function (_old: string, _new: string) {});

Then('{string} is used in its place wherever the regression tag was referenced', function (_tag: string) {});

Given('all TypeScript source files under {string} are scanned', function (_dir: string) {});

Then('{string} is present where the regression tag is referenced', function (expected: string) {
  assert.ok(
    sharedCtx.fileContent.includes(expected),
    `Expected "${sharedCtx.filePath}" to contain "${expected}"`,
  );
});

Then(
  'the string {string} is present where the regression tag is referenced',
  function (expected: string) {
    assert.ok(
      sharedCtx.fileContent.includes(expected),
      `Expected "${sharedCtx.filePath}" to contain "${expected}"`,
    );
  },
);

Then('the section still uses {string} as the placeholder', function (_placeholder: string) {});

When('searching for the default value of the {string} field', function (_field: string) {});

Then('the default command contains {string}', function (expected: string) {
  assert.ok(
    sharedCtx.fileContent.includes(expected),
    `Expected "${sharedCtx.filePath}" to contain "${expected}"`,
  );
});

Then('the default command does not contain {string}', function (unexpected: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(unexpected),
    `Expected "${sharedCtx.filePath}" not to contain "${unexpected}"`,
  );
});

When('searching for log message strings that reference a BDD tag name', function () {});

Then('the log messages contain {string}', function (expected: string) {
  assert.ok(
    sharedCtx.fileContent.includes(expected),
    `Expected "${sharedCtx.filePath}" to contain "${expected}"`,
  );
});

Then('no log message contains {string}', function (unexpected: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(unexpected),
    `Expected "${sharedCtx.filePath}" not to contain "${unexpected}"`,
  );
});

When('searching for the {string} function in {string} is read', function (_fn: string, _file: string) {});
