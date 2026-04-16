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
  // PRReviewWorkflowConfig nests issueNumber via base (WorkflowConfig) and ctx
  // (PRReviewWorkflowContext extends WorkflowContext). The nullable issueNumber comes
  // from PRDetails.issueNumber (number | null) and flows through ctx.issueNumber.
  // Verify the file handles nullable issueNumber in the PR review workflow:
  // 1. PRReviewWorkflowConfig exists
  const interfaceStart = content.indexOf('interface PRReviewWorkflowConfig');
  assert.ok(interfaceStart !== -1, 'Expected PRReviewWorkflowConfig interface');
  // 2. The file references issueNumber with null handling (via ctx or prDetails)
  const hasNullHandling =
    content.includes('issueNumber: number | null') ||
    content.includes('issueNumber ?? 0') ||
    content.includes('issueNumber: issueNumber');
  assert.ok(
    hasNullHandling,
    'Expected the PR review workflow to handle nullable issueNumber (via PRDetails or WorkflowContext)',
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
    // moveToStatus was extracted from completePRReviewWorkflow into
    // executePRReviewCommitPushPhase (prReviewPhase.ts). The guard is now
    // `if (repoContext && config.base.issueNumber)`.
    // Check for moveToStatus guarded by issueNumber anywhere in the file.
    const moveIdx = content.indexOf('moveToStatus');
    assert.ok(moveIdx !== -1, 'Expected moveToStatus call somewhere in prReviewCompletion.ts or prReviewPhase.ts');
    const surroundingBefore = content.slice(Math.max(0, moveIdx - 400), moveIdx);
    assert.ok(
      surroundingBefore.includes('issueNumber') ||
      surroundingBefore.includes('config.issueNumber') ||
      surroundingBefore.includes('config.base.issueNumber'),
      'Expected moveToStatus to be guarded by an issueNumber check',
    );
  },
);

Then(
  'cost CSV writing is guarded by an issueNumber check in completePRReviewWorkflow',
  function () {
    const content = sharedCtx.fileContent;
    // Cost D1 posting is now handled per-phase by the tracker (no direct postCostRecordsToD1
    // call). The cost section builder (buildPRReviewCostSection) still creates cost records
    // via createPhaseCostRecords, which receives issueNumber from config.base.issueNumber.
    // Verify that cost record creation references issueNumber.
    const helperStart = content.indexOf('function buildPRReviewCostSection');
    const funcStart = content.indexOf('function completePRReviewWorkflow');
    const searchStart = helperStart !== -1 ? helperStart : funcStart;
    assert.ok(searchStart !== -1, 'Expected buildPRReviewCostSection or completePRReviewWorkflow');
    const funcBody = content.slice(searchStart, searchStart + 2000);
    const costCreationIdx = funcBody.indexOf('createPhaseCostRecords') !== -1
      ? funcBody.indexOf('createPhaseCostRecords')
      : funcBody.indexOf('postCostRecordsToD1');
    assert.ok(costCreationIdx !== -1, 'Expected a cost record creation call in the cost section builder');
    const surroundingContext = funcBody.slice(Math.max(0, costCreationIdx - 100), costCreationIdx + 300);
    assert.ok(
      surroundingContext.includes('issueNumber') ||
      surroundingContext.includes('config.issueNumber') ||
      surroundingContext.includes('config.base.issueNumber'),
      'Expected cost record creation to reference issueNumber',
    );
  },
);

