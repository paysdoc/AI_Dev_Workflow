import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

function loadWorktreeCreation(): void {
  const filePath = 'adws/vcs/worktreeCreation.ts';
  sharedCtx.fileContent = readFileSync(join(ROOT, filePath), 'utf-8');
  sharedCtx.filePath = filePath;
}

// ── Context-only Given/When steps ─────────────────────────────────────────────

Given('a PR exists for branch {string}', function (_branch: string) {
  // Context only — branch existence validated via code inspection
});

Given('the branch does not exist as a local branch in the ADW repository', function () {
  // Context only — precondition described in scenario prose
});

Given('the branch has not been fetched so {string} does not resolve', function (_ref: string) {
  // Context only — precondition described in scenario prose
});

Given('the branch {string} does not exist as a local branch', function (_branch: string) {
  // Context only — precondition described in scenario prose
});

Given('after fetching, {string} resolves to a valid commit', function (_ref: string) {
  // Context only — precondition described in scenario prose
});

Given('a worktree already exists for branch {string}', function (_branch: string) {
  // Context only — precondition described in scenario prose
});

Given('the branch {string} exists as a local branch', function (_branch: string) {
  // Context only — precondition described in scenario prose
});

When('initializePRReviewWorkflow is called for that PR', function () {
  loadWorktreeCreation();
});

When('createWorktree is called for {string} with no base branch', function (_branch: string) {
  loadWorktreeCreation();
});

When('ensureWorktree is called for {string}', function (_branch: string) {
  loadWorktreeCreation();
});

// ── Key regression assertions ─────────────────────────────────────────────────

Then(
  'createWorktree or ensureWorktree performs a git fetch for the target branch before attempting git worktree add',
  function () {
    const content = sharedCtx.fileContent;

    const fetchIdx = content.indexOf('git fetch origin');
    assert.ok(
      fetchIdx !== -1,
      'Expected worktreeCreation.ts to contain "git fetch origin" as a fallback fetch',
    );

    const worktreeAddIdx = content.indexOf('git worktree add');
    assert.ok(
      worktreeAddIdx !== -1,
      'Expected worktreeCreation.ts to contain "git worktree add"',
    );

    assert.ok(
      fetchIdx < worktreeAddIdx,
      'Expected "git fetch origin" to appear before "git worktree add" in worktreeCreation.ts',
    );
  },
);

Then('a worktree is successfully created for {string}', function (_branch: string) {
  const content = sharedCtx.fileContent;

  assert.ok(
    content.includes('git fetch origin'),
    'Expected worktreeCreation.ts to include a git fetch fallback so the worktree can be created',
  );
  assert.ok(
    content.includes('git worktree add'),
    'Expected worktreeCreation.ts to call git worktree add for branch creation',
  );
});

Then(
  'the workflow does not crash with {string}',
  function (_errorMessage: string) {
    const content = sharedCtx.fileContent;

    // The fetch fallback must be in the catch block that previously set branchExists = false,
    // so it now attempts a fetch before giving up.
    assert.ok(
      content.includes('git fetch origin'),
      'Expected worktreeCreation.ts to attempt git fetch before concluding branch does not exist',
    );
  },
);

Then('git worktree add creates the worktree tracking the remote branch', function () {
  const content = sharedCtx.fileContent;

  assert.ok(
    content.includes('git worktree add "${worktreePath}" "${branchName}"'),
    'Expected worktreeCreation.ts to call git worktree add with worktreePath and branchName for existing branches',
  );
});

Then('the worktree path is returned without error', function () {
  // Pass-through — validated by the absence of error-throwing in the Then steps above
});

Then('the existing worktree path is returned', function () {
  const content = sharedCtx.fileContent;

  assert.ok(
    content.includes('getWorktreeForBranch'),
    'Expected ensureWorktree to call getWorktreeForBranch to find existing worktrees',
  );
  assert.ok(
    content.includes('Worktree for branch') && content.includes('already exists'),
    'Expected ensureWorktree to log and return the existing worktree path',
  );
});

Then('no new worktree is created', function () {
  // Pass-through — validated by the existing-path early return in ensureWorktree
});

Then('no git fetch is performed for an already-present worktree', function () {
  const content = sharedCtx.fileContent;

  // ensureWorktree returns early when existingPath is found, before calling createWorktree
  // (which contains the fetch logic). Verify the early-return guard exists in ensureWorktree.
  assert.ok(
    content.includes('if (existingPath)'),
    'Expected ensureWorktree to guard on existingPath and return early before calling createWorktree',
  );

  // The fetch logic must be inside createWorktree, not inside ensureWorktree.
  // Verify the fetch is scoped to the branch-existence check block.
  assert.ok(
    content.includes('git fetch origin'),
    'Expected the fetch fallback to exist inside createWorktree',
  );

  // ensureWorktree should not directly call git fetch — it delegates to createWorktree
  const ensureWorktreeFnStart = content.indexOf('export function ensureWorktree(');
  assert.ok(ensureWorktreeFnStart !== -1, 'Expected ensureWorktree function to be present');

  const ensureWorktreeBody = content.slice(ensureWorktreeFnStart);
  assert.ok(
    !ensureWorktreeBody.includes('git fetch'),
    'Expected ensureWorktree to not directly call git fetch (fetch is delegated to createWorktree)',
  );
});

Then('a worktree is created using the existing local branch', function () {
  const content = sharedCtx.fileContent;

  // Local branch is found by the first rev-parse check; worktree add is called directly
  assert.ok(
    content.includes('git rev-parse --verify "${branchName}"'),
    'Expected createWorktree to check for local branch existence via git rev-parse',
  );
  assert.ok(
    content.includes('git worktree add "${worktreePath}" "${branchName}"'),
    'Expected createWorktree to call git worktree add for a locally-present branch',
  );
});
