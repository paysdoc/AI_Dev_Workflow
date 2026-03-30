import { Given, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();

// Storage for multi-file scenarios
const multiFileCtx: { files: { path: string; content: string }[] } = { files: [] };

// ---------------------------------------------------------------------------
// Given steps
// ---------------------------------------------------------------------------

Given('the orchestrator files {string} and {string} are read', function (file1: string, file2: string) {
  multiFileCtx.files = [];
  for (const f of [file1, file2]) {
    const fullPath = join(ROOT, f);
    assert.ok(existsSync(fullPath), `Expected file to exist: ${f}`);
    multiFileCtx.files.push({ path: f, content: readFileSync(fullPath, 'utf-8') });
  }
});

Given('the ADW codebase with migrated orchestrators', function () {
  assert.ok(existsSync(join(ROOT, 'adws')), 'Expected adws/ directory to exist');
});

// ---------------------------------------------------------------------------
// Then steps — single-file assertions
// ---------------------------------------------------------------------------

Then('the file does not declare a local {string} variable', function (
  this: Record<string, string>,
  varName: string,
) {
  const content = this.fileContent;
  const hasLet = content.includes(`let ${varName}`);
  const hasConst = content.includes(`const ${varName}`);
  assert.ok(
    !hasLet && !hasConst,
    `Expected "${this.filePath}" not to declare a local variable "${varName}"`,
  );
});

Then('the file does not call {string} directly', function (
  this: Record<string, string>,
  fnName: string,
) {
  const content = this.fileContent;
  assert.ok(
    !content.includes(`${fnName}(`),
    `Expected "${this.filePath}" not to call "${fnName}" directly`,
  );
});

Then('the file does not import {string}', function (
  this: Record<string, string>,
  symbol: string,
) {
  const importLines = this.fileContent.split('\n').filter(l => /^\s*import\s/.test(l));
  const hasImport = importLines.some(l => l.includes(symbol));
  assert.ok(!hasImport, `Expected "${this.filePath}" not to import "${symbol}"`);
});

Then('the file passes {string} and {string} to completeWorkflow', function (
  this: Record<string, string>,
  arg1: string,
  arg2: string,
) {
  const content = this.fileContent;
  assert.ok(content.includes('completeWorkflow('), `Expected "${this.filePath}" to call completeWorkflow()`);
  assert.ok(content.includes(arg1), `Expected "${this.filePath}" to pass "${arg1}" to completeWorkflow`);
  assert.ok(content.includes(arg2), `Expected "${this.filePath}" to pass "${arg2}" to completeWorkflow`);
});

Then('the file imports {string} from the cost d1Client module', function (
  this: Record<string, string>,
  symbol: string,
) {
  const content = this.fileContent;
  const hasD1Import =
    content.includes('./cost/d1Client') ||
    content.includes('../cost/d1Client');
  assert.ok(
    content.includes(symbol) && hasD1Import,
    `Expected "${this.filePath}" to import "${symbol}" from the cost d1Client module`,
  );
});

Then('the file calls {string} to build cost records', function (
  this: Record<string, string>,
  fnName: string,
) {
  assert.ok(
    this.fileContent.includes(`${fnName}(`),
    `Expected "${this.filePath}" to call "${fnName}()"`,
  );
});

Then('the file calls {string} to send records to D1', function (
  this: Record<string, string>,
  fnName: string,
) {
  assert.ok(
    this.fileContent.includes(`${fnName}(`),
    `Expected "${this.filePath}" to call "${fnName}()"`,
  );
});

Then('the file calls {string} after the install phase', function (
  this: Record<string, string>,
  _fnName: string,
) {
  assert.ok(
    this.fileContent.includes("'pr_review_install'"),
    `Expected "${this.filePath}" to post D1 cost records for the install phase (missing 'pr_review_install')`,
  );
});

Then('the file calls {string} after the plan phase', function (
  this: Record<string, string>,
  _fnName: string,
) {
  assert.ok(
    this.fileContent.includes("'pr_review_plan'"),
    `Expected "${this.filePath}" to post D1 cost records for the plan phase (missing 'pr_review_plan')`,
  );
});

Then('the file calls {string} after the build phase', function (
  this: Record<string, string>,
  _fnName: string,
) {
  assert.ok(
    this.fileContent.includes("'pr_review_build'"),
    `Expected "${this.filePath}" to post D1 cost records for the build phase (missing 'pr_review_build')`,
  );
});

Then('the test phase D1 write is handled internally by prReviewCompletion', function () {
  const completionPath = join(ROOT, 'adws/phases/prReviewCompletion.ts');
  assert.ok(existsSync(completionPath), 'Expected adws/phases/prReviewCompletion.ts to exist');
  const content = readFileSync(completionPath, 'utf-8');
  assert.ok(
    content.includes('postCostRecordsToD1'),
    'Expected prReviewCompletion.ts to contain postCostRecordsToD1',
  );
});

Then('the file contains an {string} section', function (
  this: Record<string, string>,
  sectionName: string,
) {
  assert.ok(
    this.fileContent.includes(sectionName),
    `Expected "${this.filePath}" to contain section "${sectionName}"`,
  );
});

Then('the observability section has {string}', function (
  this: Record<string, string>,
  expectedValue: string,
) {
  const content = this.fileContent;
  const obsIdx = content.indexOf('[observability]');
  assert.ok(obsIdx !== -1, `Expected "${this.filePath}" to have [observability] section`);
  const afterObs = content.slice(obsIdx);
  assert.ok(
    afterObs.includes(expectedValue),
    `Expected observability section in "${this.filePath}" to contain "${expectedValue}"`,
  );
});

// ---------------------------------------------------------------------------
// Then steps — multi-file assertions
// ---------------------------------------------------------------------------

Then('both files import {string} from {string}', function (symbol: string, importPath: string) {
  for (const { path: filePath, content } of multiFileCtx.files) {
    assert.ok(
      content.includes(importPath) && content.includes(symbol),
      `Expected "${filePath}" to import "${symbol}" from "${importPath}"`,
    );
  }
});

Then('neither file imports {string}', function (symbol: string) {
  for (const { path: filePath, content } of multiFileCtx.files) {
    const importLines = content.split('\n').filter(l => /^\s*import\s/.test(l));
    const hasImport = importLines.some(l => l.includes(symbol));
    assert.ok(!hasImport, `Expected "${filePath}" not to import "${symbol}"`);
  }
});

Then('both files import {string} from the cost module', function (symbol: string) {
  for (const { path: filePath, content } of multiFileCtx.files) {
    const hasCostImport =
      content.includes("from './cost'") ||
      content.includes("from '../cost'") ||
      content.includes('from "./cost"') ||
      content.includes('from "../cost"');
    assert.ok(
      content.includes(symbol) && hasCostImport,
      `Expected "${filePath}" to import "${symbol}" from the cost module`,
    );
  }
});

Then('both files import {string} from the cost d1Client module', function (symbol: string) {
  for (const { path: filePath, content } of multiFileCtx.files) {
    const hasD1Import =
      content.includes('./cost/d1Client') ||
      content.includes('../cost/d1Client');
    assert.ok(
      content.includes(symbol) && hasD1Import,
      `Expected "${filePath}" to import "${symbol}" from the cost d1Client module`,
    );
  }
});

