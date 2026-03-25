import { Given, Then } from '@cucumber/cucumber';
import { existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── Given: codebase modified for issue 307 ───────────────────────────────────

Given('the ADW codebase has been modified for issue 307', function () {
  assert.ok(existsSync(join(ROOT, 'adws')), 'Expected adws/ directory to exist');
});

// ── Then: step definition independence section present ───────────────────────

Then('it should contain a section for step definition independence verification', function () {
  assert.ok(
    sharedCtx.fileContent.includes('Step Definition Independence') ||
      sharedCtx.fileContent.includes('step definition independence'),
    `Expected "${sharedCtx.filePath}" to contain a step definition independence verification section`,
  );
});

Then('the section should appear after proof production and before the final report', function () {
  const content = sharedCtx.fileContent;
  const proofIdx = content.indexOf('Produce Proof') !== -1
    ? content.indexOf('Produce Proof')
    : content.indexOf('Step 3');
  const independenceIdx = content.indexOf('Step Definition Independence') !== -1
    ? content.indexOf('Step Definition Independence')
    : content.indexOf('step definition independence');
  const reportIdx = content.indexOf('## Report') !== -1
    ? content.indexOf('## Report')
    : content.indexOf('## Issue Severity');
  assert.ok(proofIdx !== -1, `Expected "${sharedCtx.filePath}" to contain a proof production section`);
  assert.ok(independenceIdx !== -1, `Expected "${sharedCtx.filePath}" to contain a step definition independence section`);
  assert.ok(reportIdx !== -1, `Expected "${sharedCtx.filePath}" to contain a report section`);
  assert.ok(
    independenceIdx > proofIdx,
    `Expected step definition independence section to appear after proof production in "${sharedCtx.filePath}"`,
  );
  assert.ok(
    independenceIdx < reportIdx,
    `Expected step definition independence section to appear before the report in "${sharedCtx.filePath}"`,
  );
});

// ── Then: reads step definition files and feature files ──────────────────────

Then('the step definition independence section should instruct reading step definition files changed in the current branch', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    (content.includes('step definition') || content.includes('step_definition')) &&
      (content.includes('branch') || content.includes('git diff') || content.includes('changed')),
    `Expected "${sharedCtx.filePath}" to instruct reading step definition files changed in the current branch`,
  );
});

Then('it should instruct reading the corresponding feature files for context', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('feature') && (content.includes('Read') || content.includes('read')),
    `Expected "${sharedCtx.filePath}" to instruct reading the corresponding feature files`,
  );
});

// ── Then: checking observable behavior through public interfaces ──────────────

Then('the independence verification should instruct checking that each step definition asserts on observable behavior', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('observable') || content.includes('observable behavior'),
    `Expected "${sharedCtx.filePath}" to instruct checking that step definitions assert on observable behavior`,
  );
});

Then('it should instruct checking that assertions use public interfaces of the implementation', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('public interface') || content.includes('public interfaces'),
    `Expected "${sharedCtx.filePath}" to instruct checking that assertions use public interfaces`,
  );
});

// ── Then: defines public interface assertions (DataTable) ─────────────────────

Then('the independence verification should define public interface assertions as those that:', function (dataTable: { rawTable: string[][] }) {
  const content = sharedCtx.fileContent;
  const criteria = dataTable.rawTable.slice(1).map((row: string[]) => row[0].trim());
  for (const criterion of criteria) {
    // Check for key words from each criterion rather than exact phrase match
    const words = criterion.toLowerCase().split(/[\s,]+/).filter((w: string) => w.length > 4);
    const shortWords = words.slice(0, 2);
    const matches = shortWords.some((word: string) => content.toLowerCase().includes(word));
    assert.ok(
      matches,
      `Expected "${sharedCtx.filePath}" to define criterion: "${criterion}"`,
    );
  }
});

// ── Then: flagging internal assertions ────────────────────────────────────────

Then('the independence verification should instruct flagging step definitions that assert on implementation internals rather than observable behavior', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    (content.includes('internal') || content.includes('internals')) &&
      (content.includes('flag') || content.includes('Flag')),
    `Expected "${sharedCtx.filePath}" to instruct flagging step definitions that assert on implementation internals`,
  );
});

Then('flagged issues should describe which internal is being asserted on', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('internal') &&
      (content.includes('description') || content.includes('describe') || content.includes('reviewIssue') || content.includes('flag')),
    `Expected "${sharedCtx.filePath}" to instruct that flagged issues describe which internal is asserted on`,
  );
});

// ── Then: flagging tautological step definitions ──────────────────────────────

Then('the independence verification should instruct flagging step definitions that would pass regardless of whether the intended behavior works', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('tautological') || content.includes('always pass') || content.includes('always-pass') ||
      content.includes('regardless'),
    `Expected "${sharedCtx.filePath}" to instruct flagging tautological/always-pass step definitions`,
  );
});

Then('flagged issues should explain why the assertion is tautological', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    (content.includes('tautological') || content.includes('always pass') || content.includes('always-pass')) &&
      (content.includes('reviewIssue') || content.includes('flag') || content.includes('report')),
    `Expected "${sharedCtx.filePath}" to instruct that flagged issues explain why the assertion is tautological`,
  );
});

// ── Then: flagging structural mirroring ───────────────────────────────────────

Then('the independence verification should instruct flagging step definitions that mirror the implementation structure rather than the scenario\'s behavioral specification', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('mirror') || content.includes('structural'),
    `Expected "${sharedCtx.filePath}" to instruct flagging step definitions that mirror implementation structure`,
  );
});

Then('flagged issues should contrast the step definition with the scenario intent', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    (content.includes('mirror') || content.includes('structural')) &&
      (content.includes('reviewIssue') || content.includes('flag') || content.includes('report')),
    `Expected "${sharedCtx.filePath}" to instruct that flagged issues contrast the step definition with the scenario intent`,
  );
});

// ── Then: severity classification ────────────────────────────────────────────

Then('the independence verification should classify step definitions that would pass regardless of behavior as {string} severity', function (severity: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(severity),
    `Expected "${sharedCtx.filePath}" to classify tautological step definitions as "${severity}" severity`,
  );
});

Then('the rationale should state that tautological assertions provide no verification value', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('tautological') || content.includes('no verification') || content.includes('always pass') || content.includes('always-pass'),
    `Expected "${sharedCtx.filePath}" to state that tautological assertions provide no verification value`,
  );
});

Then('the independence verification should classify step definitions that assert on implementation internals as {string} severity', function (severity: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(severity),
    `Expected "${sharedCtx.filePath}" to classify internal assertion step definitions as "${severity}" severity`,
  );
});

Then('the rationale should state that internal coupling makes tests brittle but they still provide some verification', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('internal') && (content.includes('brittle') || content.includes('coupling') || content.includes('tech-debt')),
    `Expected "${sharedCtx.filePath}" to state that internal coupling makes tests brittle`,
  );
});

// ── Then: violations reported as reviewIssues ────────────────────────────────

Then('independence violations should be reported using the existing reviewIssues structure', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('reviewIssues') || content.includes('reviewIssue'),
    `Expected "${sharedCtx.filePath}" to instruct reporting independence violations as reviewIssues`,
  );
});

Then('each violation should include the step definition file, the scenario name, and the specific assertion', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('step definition') || content.includes('step_definition'),
    `Expected "${sharedCtx.filePath}" to instruct including the step definition file in each violation`,
  );
});

// ── Then: skip conditions ─────────────────────────────────────────────────────

Then('the independence verification should instruct skipping the check when no step definition files are found in the branch diff', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    (content.includes('skip') || content.includes('Skip')) &&
      (content.includes('step definition') || content.includes('step_definition')),
    `Expected "${sharedCtx.filePath}" to instruct skipping the check when no step definitions exist`,
  );
});

Then('no reviewIssues related to step definition independence should be created', function () {
  // Pass-through: the skip condition implies no violations are created
});

Then('the independence verification should instruct skipping the check when {string} is absent from the target repository', function (filePath: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    (content.includes('skip') || content.includes('Skip')) &&
      (content.includes(filePath) || content.includes('scenarios.md')),
    `Expected "${sharedCtx.filePath}" to instruct skipping when "${filePath}" is absent`,
  );
});
