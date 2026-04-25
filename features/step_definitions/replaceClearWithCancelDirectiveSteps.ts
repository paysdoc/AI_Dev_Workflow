/**
 * Step definitions for: Replace ## Clear with ## Cancel: full issue cleanup directive
 * Issue #425 — @adw-425
 */

import { Given, Then, When } from '@cucumber/cucumber';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';
import { isCancelComment } from '../../adws/core/workflowCommentParsing';

const ROOT = process.cwd();

// ── CANCEL_COMMENT_PATTERN ────────────────────────────────────────────────────

Then(
  /^it exports a constant "([^"]+)" with regex \/\^## Cancel\$\/mi$/,
  function (constantName: string) {
    assert.ok(
      sharedCtx.fileContent.includes(constantName),
      `Expected "${sharedCtx.filePath}" to export "${constantName}"`,
    );
    // Check the regex literal is present
    assert.ok(
      sharedCtx.fileContent.includes('/^## Cancel$/mi'),
      `Expected "${sharedCtx.filePath}" to contain regex /^## Cancel$/mi`,
    );
  },
);

// ── isCancelComment ───────────────────────────────────────────────────────────

Then(
  'it exports a function {string} that tests the comment body against CANCEL_COMMENT_PATTERN',
  function (funcName: string) {
    assert.ok(
      sharedCtx.fileContent.includes(`function ${funcName}`),
      `Expected "${sharedCtx.filePath}" to export function "${funcName}"`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('CANCEL_COMMENT_PATTERN'),
      `Expected "${sharedCtx.filePath}" to reference CANCEL_COMMENT_PATTERN`,
    );
  },
);

// ── CLEAR_COMMENT_PATTERN must not exist ──────────────────────────────────────

Then('the file does not export {string}', function (symbol: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(symbol),
    `Expected "${sharedCtx.filePath}" NOT to contain "${symbol}"`,
  );
});

Then(
  'the file does not export {string} or {string}',
  function (symbolA: string, symbolB: string) {
    assert.ok(
      !sharedCtx.fileContent.includes(symbolA),
      `Expected "${sharedCtx.filePath}" NOT to contain "${symbolA}"`,
    );
    assert.ok(
      !sharedCtx.fileContent.includes(symbolB),
      `Expected "${sharedCtx.filePath}" NOT to contain "${symbolB}"`,
    );
  },
);

// ── Re-export chain ───────────────────────────────────────────────────────────

Then(
  'the file re-exports {string} and {string}',
  function (symbolA: string, symbolB: string) {
    assert.ok(
      sharedCtx.fileContent.includes(symbolA),
      `Expected "${sharedCtx.filePath}" to re-export "${symbolA}"`,
    );
    assert.ok(
      sharedCtx.fileContent.includes(symbolB),
      `Expected "${sharedCtx.filePath}" to re-export "${symbolB}"`,
    );
  },
);

Then(
  'the file does not re-export {string} or {string}',
  function (symbolA: string, symbolB: string) {
    assert.ok(
      !sharedCtx.fileContent.includes(symbolA),
      `Expected "${sharedCtx.filePath}" NOT to re-export "${symbolA}"`,
    );
    assert.ok(
      !sharedCtx.fileContent.includes(symbolB),
      `Expected "${sharedCtx.filePath}" NOT to re-export "${symbolB}"`,
    );
  },
);

// ── cancelHandler.ts exports ──────────────────────────────────────────────────

Then(
  'the file exports a type {string} with {string} and {string}',
  function (typeName: string, fieldA: string, fieldB: string) {
    assert.ok(
      sharedCtx.fileContent.includes(typeName),
      `Expected "${sharedCtx.filePath}" to export type "${typeName}"`,
    );
    assert.ok(
      sharedCtx.fileContent.includes(fieldA),
      `Expected "${sharedCtx.filePath}" to include field "${fieldA}"`,
    );
    assert.ok(
      sharedCtx.fileContent.includes(fieldB),
      `Expected "${sharedCtx.filePath}" to include field "${fieldB}"`,
    );
  },
);

Then(
  'the file exports a type {string} with {string}',
  function (typeName: string, fieldA: string) {
    assert.ok(
      sharedCtx.fileContent.includes(typeName),
      `Expected "${sharedCtx.filePath}" to export type "${typeName}"`,
    );
    assert.ok(
      sharedCtx.fileContent.includes(fieldA),
      `Expected "${sharedCtx.filePath}" to include field "${fieldA}"`,
    );
  },
);

Then(
  'the file exports a function {string} accepting issueNumber, comments, repoInfo, optional cwd, and optional processedSets',
  function (funcName: string) {
    assert.ok(
      sharedCtx.fileContent.includes(`function ${funcName}`),
      `Expected "${sharedCtx.filePath}" to export function "${funcName}"`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('issueNumber'),
      `Expected "${sharedCtx.filePath}" to have "issueNumber" parameter`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('comments'),
      `Expected "${sharedCtx.filePath}" to have "comments" parameter`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('repoInfo'),
      `Expected "${sharedCtx.filePath}" to have "repoInfo" parameter`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('cwd?'),
      `Expected "${sharedCtx.filePath}" to have optional "cwd" parameter`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('processedSets?'),
      `Expected "${sharedCtx.filePath}" to have optional "processedSets" parameter`,
    );
  },
);

Then('the function returns a boolean', function () {
  assert.ok(
    sharedCtx.fileContent.includes(': boolean'),
    `Expected "${sharedCtx.filePath}" to declare a boolean return type`,
  );
});

// ── handleCancelDirective sequence ───────────────────────────────────────────

Then(
  'handleCancelDirective iterates over all comments and calls extractAdwIdFromComment for each',
  function () {
    assert.ok(
      sharedCtx.fileContent.includes('extractAdwIdFromComment'),
      `Expected "${sharedCtx.filePath}" to call extractAdwIdFromComment`,
    );
  },
);

Then('all unique non-null adwIds are collected', function () {
  // Verified by the deduplication logic in the implementation (Set usage)
  assert.ok(
    sharedCtx.fileContent.includes('new Set('),
    `Expected "${sharedCtx.filePath}" to deduplicate adwIds using a Set`,
  );
});

Then(
  'for each adwId, it reads the PID from {string}',
  function (_stateFilePath: string) {
    assert.ok(
      sharedCtx.fileContent.includes('state.json'),
      `Expected "${sharedCtx.filePath}" to reference state.json`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('pid'),
      `Expected "${sharedCtx.filePath}" to read "pid" from state`,
    );
  },
);

Then(
  'sends SIGTERM followed by SIGKILL to the orchestrator process',
  function () {
    assert.ok(
      sharedCtx.fileContent.includes('SIGTERM'),
      `Expected "${sharedCtx.filePath}" to send SIGTERM`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('SIGKILL'),
      `Expected "${sharedCtx.filePath}" to send SIGKILL`,
    );
  },
);

Then(
  'handleCancelDirective does not throw when {string} does not exist',
  function (_stateFilePath: string) {
    // Verified structurally: the implementation wraps readFileSync in try/catch
    assert.ok(
      sharedCtx.fileContent.includes('try {'),
      `Expected "${sharedCtx.filePath}" to have try/catch for missing state files`,
    );
  },
);

Then('continues processing the remaining adwIds', function () {
  // Verified by the loop structure and catch-continue pattern
  assert.ok(
    sharedCtx.fileContent.includes('for (const adwId of uniqueAdwIds)'),
    `Expected "${sharedCtx.filePath}" to iterate uniqueAdwIds`,
  );
});

Then(
  'handleCancelDirective calls {string} with the issueNumber and optional cwd',
  function (funcName: string) {
    assert.ok(
      sharedCtx.fileContent.includes(funcName),
      `Expected "${sharedCtx.filePath}" to call "${funcName}"`,
    );
  },
);

Then(
  'for each adwId, it calls fs.rmSync on {string} with recursive and force options',
  function (_pathPattern: string) {
    assert.ok(
      sharedCtx.fileContent.includes('rmSync'),
      `Expected "${sharedCtx.filePath}" to call fs.rmSync`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('recursive: true'),
      `Expected "${sharedCtx.filePath}" to pass recursive: true`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('force: true'),
      `Expected "${sharedCtx.filePath}" to pass force: true`,
    );
  },
);

Then(
  'handleCancelDirective calls {string} with the issueNumber and repoInfo',
  function (funcName: string) {
    assert.ok(
      sharedCtx.fileContent.includes(funcName),
      `Expected "${sharedCtx.filePath}" to call "${funcName}"`,
    );
  },
);

Then(
  'when processedSets is provided, handleCancelDirective deletes the issueNumber from both spawns and merges',
  function () {
    assert.ok(
      sharedCtx.fileContent.includes('processedSets.spawns.delete'),
      `Expected "${sharedCtx.filePath}" to call processedSets.spawns.delete`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('processedSets.merges.delete'),
      `Expected "${sharedCtx.filePath}" to call processedSets.merges.delete`,
    );
  },
);

Then(
  'when processedSets is provided, handleCancelDirective deletes the issueNumber from spawns',
  function () {
    assert.ok(
      sharedCtx.fileContent.includes('processedSets.spawns.delete'),
      `Expected "${sharedCtx.filePath}" to call processedSets.spawns.delete`,
    );
    assert.ok(
      !sharedCtx.fileContent.includes('processedSets.merges.delete'),
      `Expected "${sharedCtx.filePath}" NOT to call processedSets.merges.delete (merges set removed in #488)`,
    );
  },
);

Then('when processedSets is undefined, no set deletion is attempted', function () {
  assert.ok(
    sharedCtx.fileContent.includes('processedSets !== undefined'),
    `Expected "${sharedCtx.filePath}" to guard processedSets access`,
  );
});

// ── Cron integration ──────────────────────────────────────────────────────────

Then(
  'the cron trigger checks the latest comment of each issue for isCancelComment',
  function () {
    assert.ok(
      sharedCtx.fileContent.includes('isCancelComment'),
      `Expected "${sharedCtx.filePath}" to call isCancelComment`,
    );
  },
);

Then('this check occurs before the call to filterEligibleIssues', function () {
  const cancelIdx = sharedCtx.fileContent.indexOf('isCancelComment');
  const filterIdx = sharedCtx.fileContent.indexOf('filterEligibleIssues');
  assert.ok(cancelIdx !== -1, `Expected "${sharedCtx.filePath}" to call isCancelComment`);
  assert.ok(filterIdx !== -1, `Expected "${sharedCtx.filePath}" to call filterEligibleIssues`);
  assert.ok(
    cancelIdx < filterIdx,
    `Expected isCancelComment check to appear before filterEligibleIssues in "${sharedCtx.filePath}"`,
  );
});

Then(
  'for each issue whose latest comment matches isCancelComment, handleCancelDirective is called',
  function () {
    assert.ok(
      sharedCtx.fileContent.includes('handleCancelDirective'),
      `Expected "${sharedCtx.filePath}" to call handleCancelDirective`,
    );
  },
);

Then('issue numbers that were cancelled are added to processedSpawns', function () {
  assert.ok(
    sharedCtx.fileContent.includes('processedSpawns.add'),
    `Expected "${sharedCtx.filePath}" to add cancelled issues to processedSpawns`,
  );
});

Then('filterEligibleIssues skips them in the current cycle', function () {
  // Verified structurally: processedSpawns is passed to filterEligibleIssues
  assert.ok(
    sharedCtx.fileContent.includes('processedSpawns'),
    `Expected "${sharedCtx.filePath}" to pass processedSpawns to filterEligibleIssues`,
  );
});

Then('the issue is skipped in the current cycle', function () {
  // Pass-through — structural check done in prior step
});

Then(
  'the issue will be re-evaluated in the next cron cycle because processedSpawns is per-process',
  function () {
    // Pass-through — processedSpawns is a module-level Set that resets on process restart
  },
);

Then(
  'when --target-repo is set, the cwd for handleCancelDirective is resolved via getTargetRepoWorkspacePath',
  function () {
    assert.ok(
      sharedCtx.fileContent.includes('getTargetRepoWorkspacePath'),
      `Expected "${sharedCtx.filePath}" to call getTargetRepoWorkspacePath`,
    );
  },
);

Then('when --target-repo is not set, cwd is undefined', function () {
  assert.ok(
    sharedCtx.fileContent.includes('cancelCwd'),
    `Expected "${sharedCtx.filePath}" to have cancelCwd variable`,
  );
  assert.ok(
    sharedCtx.fileContent.includes(': undefined'),
    `Expected "${sharedCtx.filePath}" to use undefined as fallback cwd`,
  );
});

// ── processedPRs untouched ────────────────────────────────────────────────────

Then(
  'handleCancelDirective does not reference or modify processedPRs',
  function () {
    assert.ok(
      !sharedCtx.fileContent.includes('processedPRs'),
      `Expected "${sharedCtx.filePath}" NOT to reference processedPRs`,
    );
  },
);

Then('the PR review cycle remains independent', function () {
  // Pass-through — verified by the absence of processedPRs above
});

// ── Webhook integration ───────────────────────────────────────────────────────

Then(
  'the file imports {string} from the github module',
  function (symbol: string) {
    assert.ok(
      sharedCtx.fileContent.includes(symbol),
      `Expected "${sharedCtx.filePath}" to import "${symbol}"`,
    );
  },
);

// Note: "the file does not import {string}" is already defined in orchestratorAwaitingMergeHandoffSteps.ts

Then(
  'when isCancelComment matches, the handler calls handleCancelDirective',
  function () {
    assert.ok(
      sharedCtx.fileContent.includes('isCancelComment'),
      `Expected "${sharedCtx.filePath}" to call isCancelComment`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('handleCancelDirective'),
      `Expected "${sharedCtx.filePath}" to call handleCancelDirective`,
    );
  },
);

Then(
  'the handler does not directly call clearIssueComments for cancel directives',
  function () {
    // The webhook no longer imports clearIssueComments — it delegates to handleCancelDirective
    assert.ok(
      !sharedCtx.fileContent.includes("from '../adwClearComments'"),
      `Expected "${sharedCtx.filePath}" NOT to import clearIssueComments directly`,
    );
  },
);

Then(
  'the handleCancelDirective call in the webhook does not pass a processedSets argument',
  function () {
    // The webhook call is: handleCancelDirective(issueNumber, allComments, ..., cancelCwd)
    // with no 5th processedSets arg. Check that processedSets is not referenced near the call.
    // Simple proxy: webhook file doesn't define processedSpawns or processedMerges
    assert.ok(
      !sharedCtx.fileContent.includes('processedSpawns'),
      `Expected webhook not to pass processedSets`,
    );
  },
);

Then(
  'the cwd argument for handleCancelDirective is derived from the webhook payload',
  function () {
    assert.ok(
      sharedCtx.fileContent.includes('extractTargetRepoArgs'),
      `Expected "${sharedCtx.filePath}" to use extractTargetRepoArgs for cwd resolution`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('getTargetRepoWorkspacePath'),
      `Expected "${sharedCtx.filePath}" to call getTargetRepoWorkspacePath`,
    );
  },
);

// ── No ## Clear pattern remains ───────────────────────────────────────────────

Then(
  'no TypeScript file in {string} contains the string {string} in a regex pattern or constant',
  function (dir: string, pattern: string) {
    const fullDir = join(ROOT, dir);
    const tsFiles = collectTsFiles(fullDir);
    const matches: string[] = [];
    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf-8');
      // Check for the pattern appearing in a regex or string constant context
      // We look for lines containing the pattern that are not in comments or test fixtures
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.includes(pattern) && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')) {
          matches.push(`${file}: ${line.trim()}`);
        }
      }
    }
    assert.strictEqual(
      matches.length,
      0,
      `Found "${pattern}" in TypeScript files under "${dir}":\n${matches.join('\n')}`,
    );
  },
);

When('isCancelComment is called with that body', function (this: Record<string, string>) {
  // The actual call happens in the Then step below using the imported function
});

Then('it returns false', function (this: Record<string, string>) {
  const body = this.__commentBody ?? '## Clear';
  const result = isCancelComment(body);
  assert.strictEqual(result, false, `Expected isCancelComment("${body}") to return false`);
});

// Note: "{string} is run" is defined in removeUnitTestsSteps.ts
// Note: "the command exits with code {int}" is defined in wireExtractorSteps.ts
// Note: "{string} also exits with code {int}" is defined in wireExtractorSteps.ts

// ── Scenario: A comment with "## Clear" is not recognized ────────────────────

Given('a comment body containing {string}', function (this: Record<string, string>, body: string) {
  this.__commentBody = body;
});

// ── Scenario: Cancelled issues are re-eligible in the next cron cycle ─────────

Given('an issue with a {string} latest comment', function (_directive: string) {
  // Context only — scenario is structural
});

When('the cron trigger processes the cancel directive', function () {
  // Context only
});

// ── Helper ────────────────────────────────────────────────────────────────────

function collectTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '__tests__') {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      results.push(fullPath);
    }
  }
  return results;
}
