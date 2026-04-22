import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx, findFunctionUsageIndex } from './commonSteps.ts';

// ── Export checks ─────────────────────────────────────────────────────────────

Then('the file exports a function named {string}', function (funcName: string) {
  const content = sharedCtx.fileContent;
  const hasDirectExport =
    content.includes(`export function ${funcName}`) ||
    content.includes(`export async function ${funcName}`);
  assert.ok(
    hasDirectExport,
    `Expected "${sharedCtx.filePath}" to export a function named "${funcName}"`,
  );
});

Then('the file exports {string}', function (exportName: string) {
  const content = sharedCtx.fileContent;
  const hasDirectExport =
    content.includes(`export function ${exportName}`) ||
    content.includes(`export async function ${exportName}`) ||
    content.includes(`export const ${exportName}`) ||
    content.includes(`export class ${exportName}`) ||
    content.includes(`export interface ${exportName}`) ||
    content.includes(`export type ${exportName} `);
  // Handles named re-exports in barrel files (single-line or multi-line)
  const hasNamedExport =
    content.includes(`  ${exportName},`) ||
    content.includes(`{ ${exportName} }`) ||
    content.includes(`{ ${exportName},`) ||
    content.includes(`, ${exportName} }`) ||
    content.includes(`, ${exportName},`);
  assert.ok(
    hasDirectExport || hasNamedExport,
    `Expected "${sharedCtx.filePath}" to export "${exportName}"`,
  );
});

// ── Function-call checks ──────────────────────────────────────────────────────

Then('the function {string} calls {string}', function (callerFunc: string, calleeFunc: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(callerFunc),
    `Expected function "${callerFunc}" to be defined in "${sharedCtx.filePath}"`,
  );
  assert.ok(
    content.includes(calleeFunc),
    `Expected "${callerFunc}" in "${sharedCtx.filePath}" to call "${calleeFunc}"`,
  );
});

// ── approvePR-specific checks ─────────────────────────────────────────────────

Then(
  'the {string} function deletes process.env.GH_TOKEN before calling gh pr review',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('delete process.env.GH_TOKEN'),
      `Expected "${funcName}" in "${sharedCtx.filePath}" to delete process.env.GH_TOKEN`,
    );
    const deleteIdx = content.indexOf('delete process.env.GH_TOKEN');
    const reviewIdx = content.indexOf('gh pr review');
    assert.ok(reviewIdx !== -1, `Expected "${sharedCtx.filePath}" to contain "gh pr review"`);
    assert.ok(
      deleteIdx < reviewIdx,
      `Expected "delete process.env.GH_TOKEN" to appear before "gh pr review" in "${sharedCtx.filePath}"`,
    );
  },
);

Then(
  'the {string} function restores GH_TOKEN in a finally block',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const finallyIdx = content.indexOf('finally');
    assert.ok(
      finallyIdx !== -1,
      `Expected "${sharedCtx.filePath}" to contain a finally block in "${funcName}"`,
    );
    const finallyBlock = content.substring(finallyIdx, finallyIdx + 600);
    assert.ok(
      finallyBlock.includes('GH_TOKEN') || finallyBlock.includes('savedToken'),
      `Expected the finally block in "${sharedCtx.filePath}" to restore GH_TOKEN`,
    );
  },
);

// ── Multi-string file checks ──────────────────────────────────────────────────

Then('the file contains {string} and {string}', function (str1: string, str2: string) {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes(str1), `Expected "${sharedCtx.filePath}" to contain "${str1}"`);
  assert.ok(content.includes(str2), `Expected "${sharedCtx.filePath}" to contain "${str2}"`);
});

// ── autoMergePhase-specific checks ───────────────────────────────────────────

Then('the phase calls {string} to decide whether to approve', function (funcName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`${funcName}(`),
    `Expected "${sharedCtx.filePath}" to call "${funcName}()" to decide whether to approve`,
  );
});

Then(
  'the phase calls {string} when the GitHub App is configured',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('isGitHubAppConfigured'),
      `Expected "${sharedCtx.filePath}" to call isGitHubAppConfigured()`,
    );
    assert.ok(
      content.includes(funcName),
      `Expected "${sharedCtx.filePath}" to call "${funcName}" when the GitHub App is configured`,
    );
  },
);

Then(
  'the phase skips approval and proceeds directly to merge when no GitHub App is configured',
  function () {
    const content = sharedCtx.fileContent;
    const hasSkipIndicator =
      content.includes('skipping') ||
      content.includes('No GitHub App') ||
      content.includes('directly');
    assert.ok(
      hasSkipIndicator,
      `Expected "${sharedCtx.filePath}" to log a skip/direct-merge message when no GitHub App is configured`,
    );
  },
);

Then('the phase calls {string} for the merge step', function (funcName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(funcName),
    `Expected "${sharedCtx.filePath}" to call "${funcName}" for the merge step`,
  );
});

Then(
  'the phase calls {string} when the merge outcome is unsuccessful',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(funcName),
      `Expected "${sharedCtx.filePath}" to call "${funcName}" on unsuccessful merge outcome`,
    );
    assert.ok(
      content.includes('mergeOutcome.success') || content.includes('mergeOutcome'),
      `Expected "${sharedCtx.filePath}" to check merge outcome before calling "${funcName}"`,
    );
  },
);

Then(
  'the function {string} returns a result object instead of throwing on failure',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(funcName),
      `Expected function "${funcName}" to be defined in "${sharedCtx.filePath}"`,
    );
    assert.ok(
      content.includes('return {'),
      `Expected "${funcName}" in "${sharedCtx.filePath}" to return a result object on failure`,
    );
  },
);

// ── Import checks ─────────────────────────────────────────────────────────────

Then(
  'the file imports {string} from {string}',
  function (importName: string, modulePath: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(importName),
      `Expected "${sharedCtx.filePath}" to import "${importName}"`,
    );
    assert.ok(
      content.includes(`from '${modulePath}'`) || content.includes(`from "${modulePath}"`),
      `Expected "${sharedCtx.filePath}" to import from "${modulePath}"`,
    );
  },
);

// ── Ordering checks ───────────────────────────────────────────────────────────

Then('{string} is called after {string}', function (laterFunc: string, earlierFunc: string) {
  const content = sharedCtx.fileContent;
  const laterIdx = findFunctionUsageIndex(content, laterFunc);
  const earlierIdx = findFunctionUsageIndex(content, earlierFunc);
  assert.ok(laterIdx !== -1, `Expected "${laterFunc}" to be called in "${sharedCtx.filePath}"`);
  assert.ok(earlierIdx !== -1, `Expected "${earlierFunc}" to be called in "${sharedCtx.filePath}"`);
  assert.ok(laterIdx > earlierIdx, `Expected "${laterFunc}" to be called after "${earlierFunc}" in "${sharedCtx.filePath}"`);
});

Then('{string} is called before {string}', function (earlierFunc: string, laterFunc: string) {
  const content = sharedCtx.fileContent;
  const earlierIdx = findFunctionUsageIndex(content, earlierFunc);
  const laterIdx = findFunctionUsageIndex(content, laterFunc);
  assert.ok(earlierIdx !== -1, `Expected "${earlierFunc}" to be called in "${sharedCtx.filePath}"`);
  assert.ok(laterIdx !== -1, `Expected "${laterFunc}" to be called in "${sharedCtx.filePath}"`);
  assert.ok(earlierIdx < laterIdx, `Expected "${earlierFunc}" to be called before "${laterFunc}" in "${sharedCtx.filePath}"`);
});
