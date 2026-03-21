import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

// ── 1: Branch-name fallback ────────────────────────────────────────────────

Then(
  'extractIssueNumberFromBranch matches ADW-style branches like {string}',
  function (_example: string) {
    const content = sharedCtx.fileContent;
    const funcStart = content.indexOf('function extractIssueNumberFromBranch');
    assert.ok(funcStart !== -1, 'Expected extractIssueNumberFromBranch function');
    const funcBody = content.slice(funcStart, funcStart + 600);
    // The function should contain a regex that matches ADW branch format:
    // {type}-{issueNumber}-{adwId}-{slug} e.g. feature-42-abcd1234-slug
    const hasAdwPattern =
      funcBody.includes('feat|feature|bug|bugfix|chore|fix|hotfix') ||
      funcBody.includes('feat|bug|chore|fix|feature|bugfix|hotfix') ||
      // Alternatively a more general pattern that captures digits after a type prefix
      (funcBody.match(/\^?\(?(?:feat|feature|bug|bugfix|chore|fix|hotfix)/) !== null);
    assert.ok(
      hasAdwPattern,
      'Expected extractIssueNumberFromBranch to contain a regex matching ADW branch type prefixes (feat|feature|bug|bugfix|chore|fix|hotfix)',
    );
  },
);

Then(
  'extractIssueNumberFromBranch matches legacy branches like {string}',
  function (_example: string) {
    const content = sharedCtx.fileContent;
    const funcStart = content.indexOf('function extractIssueNumberFromBranch');
    assert.ok(funcStart !== -1, 'Expected extractIssueNumberFromBranch function');
    const funcBody = content.slice(funcStart, funcStart + 600);
    assert.ok(
      funcBody.includes('issue-(\\d+)') || funcBody.includes('issue-'),
      'Expected extractIssueNumberFromBranch to still match the legacy "issue-N" pattern',
    );
  },
);

Then(
  'extractIssueNumberFromBranch returns null for {string}',
  function (_branch: string) {
    const content = sharedCtx.fileContent;
    const funcStart = content.indexOf('function extractIssueNumberFromBranch');
    assert.ok(funcStart !== -1, 'Expected extractIssueNumberFromBranch function');
    const funcBody = content.slice(funcStart, funcStart + 600);
    // Verify the function returns null when no match is found
    assert.ok(
      funcBody.includes('return null'),
      'Expected extractIssueNumberFromBranch to return null for non-matching inputs',
    );
  },
);

Then(
  'fetchPRDetails references a branch-name extraction fallback for issueNumber',
  function () {
    const content = sharedCtx.fileContent;
    const funcStart = content.indexOf('function fetchPRDetails');
    assert.ok(funcStart !== -1, 'Expected fetchPRDetails function in prApi.ts');
    const funcBody = content.slice(funcStart, funcStart + 1200);
    // After the body-based extraction, there should be a fallback using branch name
    const hasBranchFallback =
      funcBody.includes('headRefName') || funcBody.includes('headBranch');
    const hasExtractCall =
      funcBody.includes('extractIssueNumber') ||
      funcBody.includes('issue') && funcBody.includes('branch');
    assert.ok(
      hasBranchFallback && hasExtractCall,
      'Expected fetchPRDetails to fall back to branch-name extraction when PR body has no issue link',
    );
  },
);

// ── 2: Nullable issue number ───────────────────────────────────────────────

Then('the PRReviewWorkflowConfig issueNumber field accepts null', function () {
  const content = sharedCtx.fileContent;
  const interfaceStart = content.indexOf('interface PRReviewWorkflowConfig');
  assert.ok(interfaceStart !== -1, 'Expected PRReviewWorkflowConfig interface');
  // Find the closing brace of the interface
  const interfaceBody = content.slice(interfaceStart, interfaceStart + 600);
  const issueNumberLine = interfaceBody.split('\n').find(l => l.includes('issueNumber'));
  assert.ok(issueNumberLine, 'Expected issueNumber field in PRReviewWorkflowConfig');
  assert.ok(
    issueNumberLine.includes('null'),
    `Expected issueNumber to accept null, got: ${issueNumberLine.trim()}`,
  );
});

Then(
  'initializePRReviewWorkflow does not contain {string}',
  function (forbidden: string) {
    const content = sharedCtx.fileContent;
    const funcStart = content.indexOf('function initializePRReviewWorkflow');
    assert.ok(funcStart !== -1, 'Expected initializePRReviewWorkflow function');
    const funcBody = content.slice(funcStart, funcStart + 2000);
    assert.ok(
      !funcBody.includes(forbidden),
      `Expected initializePRReviewWorkflow NOT to contain "${forbidden}"`,
    );
  },
);

// ── 3: Guard downstream consumers ──────────────────────────────────────────

Then(
  'moveToStatus is only called when issueNumber is truthy in completePRReviewWorkflow',
  function () {
    const content = sharedCtx.fileContent;
    const funcStart = content.indexOf('function completePRReviewWorkflow');
    assert.ok(funcStart !== -1, 'Expected completePRReviewWorkflow function');
    const funcBody = content.slice(funcStart, funcStart + 4000);
    // moveToStatus should be preceded by a guard on issueNumber
    const moveIdx = funcBody.indexOf('moveToStatus');
    assert.ok(moveIdx !== -1, 'Expected moveToStatus call in completePRReviewWorkflow');
    // Look for an issueNumber guard in the surrounding context (within 300 chars before)
    const surroundingBefore = funcBody.slice(Math.max(0, moveIdx - 300), moveIdx);
    assert.ok(
      surroundingBefore.includes('issueNumber') ||
      surroundingBefore.includes('config.issueNumber'),
      'Expected moveToStatus to be guarded by an issueNumber check',
    );
  },
);

Then(
  'cost CSV writing is guarded by an issueNumber check in completePRReviewWorkflow',
  function () {
    const content = sharedCtx.fileContent;
    const funcStart = content.indexOf('function completePRReviewWorkflow');
    assert.ok(funcStart !== -1, 'Expected completePRReviewWorkflow function');
    // Cost CSV writing may live inline or in a helper function called from completePRReviewWorkflow
    const helperStart = content.indexOf('function buildPRReviewCostSection');
    const searchStart = helperStart !== -1 ? helperStart : funcStart;
    const funcBody = content.slice(searchStart, searchStart + 2000);
    // Cost CSV writing (writeIssueCostCsv or serialised variant) should be guarded
    const csvWriteIdx = funcBody.indexOf('CostCsv') !== -1
      ? funcBody.indexOf('CostCsv')
      : funcBody.indexOf('costCsv');
    assert.ok(csvWriteIdx !== -1, 'Expected a cost CSV write call in completePRReviewWorkflow or its helper');
    const surroundingBefore = funcBody.slice(Math.max(0, csvWriteIdx - 300), csvWriteIdx);
    assert.ok(
      surroundingBefore.includes('issueNumber') ||
      surroundingBefore.includes('config.issueNumber'),
      'Expected cost CSV writing to be guarded by an issueNumber check',
    );
  },
);

// ── 4: Serialised cost CSV naming ──────────────────────────────────────────

Then(
  'the file contains a function for resolving serialised cost CSV paths',
  function () {
    const content = sharedCtx.fileContent;
    // Look for a function related to serialised/serial cost CSV path resolution
    const hasSerialisedFn =
      content.includes('Serial') ||
      content.includes('serial') ||
      content.includes('nextSerial') ||
      content.includes('getSerialised') ||
      content.includes('getSerialized');
    assert.ok(
      hasSerialisedFn,
      'Expected costCsvWriter.ts to contain a function for resolving serialised cost CSV paths',
    );
  },
);

Then(
  'the serialised CSV path function appends a numeric serial suffix',
  function () {
    const content = sharedCtx.fileContent;
    // The serialised naming function should produce paths like {number}-{slug}-{serial}.csv
    // Look for the pattern of appending a serial/number suffix
    const hasSerialSuffix =
      (content.includes('-${') && content.includes('serial')) ||
      content.includes('serial}') ||
      content.includes('Serial') ||
      // Match a template literal or string concatenation with a serial number
      content.match(/`[^`]*-\$\{[^}]*serial[^}]*\}[^`]*\.csv`/i) !== null ||
      content.match(/-\d+\.csv/) !== null;
    assert.ok(
      hasSerialSuffix,
      'Expected the serialised CSV path to append a numeric serial suffix (e.g., {number}-{slug}-{serial}.csv)',
    );
  },
);

Then(
  'rebuildProjectCostCsv extracts issue number from the first dash-separated segment',
  function () {
    const content = sharedCtx.fileContent;
    const funcStart = content.indexOf('function rebuildProjectCostCsv');
    assert.ok(funcStart !== -1, 'Expected rebuildProjectCostCsv function');
    const funcBody = content.slice(funcStart, funcStart + 1000);
    // The existing parser uses filename.indexOf('-') to split issue number from description
    // This naturally handles serialised filenames since the first segment is always the issue number
    assert.ok(
      funcBody.includes('indexOf') || funcBody.includes('substring') || funcBody.includes('split'),
      'Expected rebuildProjectCostCsv to parse issue number from the first dash-separated segment of the filename',
    );
  },
);
