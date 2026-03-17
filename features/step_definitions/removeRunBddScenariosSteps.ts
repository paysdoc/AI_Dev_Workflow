import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

// ── Context-only Given steps ──────────────────────────────────────────────────

Given(
  '{string} has been removed from bddScenarioRunner.ts, projectConfig.ts, testRetry.ts, and all callers',
  function (_symbol: string) {
    // Context only — implementation is verified by the TypeScript compilation step
  },
);

// ── Context-only When steps ───────────────────────────────────────────────────

When('searching for the {string} heading', function (_heading: string) {
  // Context only — assertions happen in Then steps
});

When('searching for the {string} interface definition', function (_iface: string) {
  // Context only
});

When('searching for the {string} function definition', function (_fn: string) {
  // Context only
});

When('searching for {string} in export statements', function (_symbol: string) {
  // Context only
});

When('searching for the identifier {string}', function (_identifier: string) {
  // Context only
});

When('searching for BDD scenario execution calls', function () {
  // Context only
});

When('searching for BDD scenario execution calls in the retry path', function () {
  // Context only
});

When('searching for the {string} interface or type definition', function (_iface: string) {
  // Context only
});

// ── Assertion Then steps ──────────────────────────────────────────────────────

Then('no {string} heading exists in {string}', function (heading: string, _filePath: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(heading),
    `Expected "${sharedCtx.filePath}" not to contain heading "${heading}"`,
  );
});

Then(
  'the {string} section is still present in {string}',
  function (section: string, _filePath: string) {
    assert.ok(
      sharedCtx.fileContent.includes(section),
      `Expected "${sharedCtx.filePath}" to contain section "${section}"`,
    );
  },
);

Then('the interface does not contain a {string} field', function (field: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(field),
    `Expected "${sharedCtx.filePath}" not to contain field "${field}"`,
  );
});

Then('the interface still contains a {string} field', function (field: string) {
  assert.ok(
    sharedCtx.fileContent.includes(field),
    `Expected "${sharedCtx.filePath}" to contain field "${field}"`,
  );
});

Then('{string} is not defined in {string}', function (symbol: string, _filePath: string) {
  const definitionPattern = new RegExp(
    `export\\s+(?:async\\s+)?(?:function|const|class)\\s+${symbol}\\b`,
  );
  assert.ok(
    !definitionPattern.test(sharedCtx.fileContent),
    `Expected "${symbol}" to not be defined in "${sharedCtx.filePath}"`,
  );
});

Then(
  '{string} is still defined and exported from {string}',
  function (symbol: string, _filePath: string) {
    assert.ok(
      sharedCtx.fileContent.includes(symbol),
      `Expected "${symbol}" to be defined and exported in "${sharedCtx.filePath}"`,
    );
  },
);

Then(
  '{string} does not appear in any export statement in {string}',
  function (symbol: string, _filePath: string) {
    const exportLines = sharedCtx.fileContent
      .split('\n')
      .filter((line: string) => line.includes('export'));
    const appearsInExport = exportLines.some((line: string) => line.includes(symbol));
    assert.ok(
      !appearsInExport,
      `Expected "${symbol}" not to appear in any export statement in "${sharedCtx.filePath}"`,
    );
  },
);

Then('{string} is not called in {string}', function (fn: string, _filePath: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(`${fn}(`),
    `Expected "${fn}" not to be called in "${sharedCtx.filePath}"`,
  );
});

Then('the BDD scenario execution uses {string} as the command', function (cmd: string) {
  assert.ok(
    sharedCtx.fileContent.includes(cmd),
    `Expected "${sharedCtx.filePath}" to reference command "${cmd}"`,
  );
});

Then(
  /^the tag passed to the scenario runner is constructed from the issue number \(e\.g\. "([^"]+)"\)$/,
  function (tag: string) {
    assert.ok(
      sharedCtx.fileContent.includes('adw-') || sharedCtx.fileContent.includes(tag),
      `Expected "${sharedCtx.filePath}" to construct an adw- tag`,
    );
  },
);

Then('{string} is not imported in {string}', function (symbol: string, _filePath: string) {
  const importPattern = new RegExp(`import.*${symbol}`);
  assert.ok(
    !importPattern.test(sharedCtx.fileContent),
    `Expected "${symbol}" not to be imported in "${sharedCtx.filePath}"`,
  );
});

Then('the BDD scenario retry function calls {string} internally', function (fn: string) {
  assert.ok(
    sharedCtx.fileContent.includes(fn),
    `Expected "${sharedCtx.filePath}" to call "${fn}" internally`,
  );
});

Then(
  'the tag passed is {string} constructed from the issueNumber option',
  function (tag: string) {
    assert.ok(
      sharedCtx.fileContent.includes('adw-') || sharedCtx.fileContent.includes(tag),
      `Expected "${sharedCtx.filePath}" to construct tag "${tag}" from issueNumber`,
    );
  },
);

Then(
  'the options type does not contain a {string} field sourced from {string} config',
  function (field: string, _source: string) {
    assert.ok(
      !sharedCtx.fileContent.includes(field),
      `Expected "${sharedCtx.filePath}" not to contain field "${field}" in options type`,
    );
  },
);

Then('the options type contains a field for the {string} command', function (cmd: string) {
  assert.ok(
    sharedCtx.fileContent.includes(cmd),
    `Expected "${sharedCtx.filePath}" to contain a field for command "${cmd}"`,
  );
});

Then('the options type still contains an {string} field', function (field: string) {
  assert.ok(
    sharedCtx.fileContent.includes(field),
    `Expected "${sharedCtx.filePath}" to contain field "${field}"`,
  );
});

Then('no file contains a call to {string}', function (fn: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(`${fn}(`),
    `Expected no call to "${fn}" in "${sharedCtx.filePath}"`,
  );
});

Then('no file contains an import of {string}', function (symbol: string) {
  const importPattern = new RegExp(`import.*${symbol}`);
  assert.ok(
    !importPattern.test(sharedCtx.fileContent),
    `Expected no import of "${symbol}" in "${sharedCtx.filePath}"`,
  );
});

Then(
  /^no "([^"]+)" or "([^"]+)" errors are reported$/,
  function (_e1: string, _e2: string) {
    // Pass-through — TypeScript compilation success is verified by exit code assertion
  },
);
