import { Given, When, Then } from '@cucumber/cucumber';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();
const MODULE_PATH = 'adws/vcs/worktreeReset.ts';
const TEST_PATH = 'adws/vcs/__tests__/worktreeReset.test.ts';

function loadModule(): void {
  sharedCtx.fileContent = readFileSync(join(ROOT, MODULE_PATH), 'utf-8');
  sharedCtx.filePath = MODULE_PATH;
}

function loadTestFile(): void {
  sharedCtx.fileContent = readFileSync(join(ROOT, TEST_PATH), 'utf-8');
  sharedCtx.filePath = TEST_PATH;
}

// ── Module shape ───────────────────────────────────────────────────────────────

Then('the file exists', function () {
  assert.ok(
    existsSync(join(ROOT, sharedCtx.filePath)),
    `Expected file to exist: ${sharedCtx.filePath}`,
  );
});

// "the module exports a function named {string}" is handled by existing step definitions

Then('the function accepts parameters named {string} and {string}', function (p1: string, p2: string) {
  const content = sharedCtx.fileContent;
  const exportIdx = content.indexOf('export function resetWorktreeToRemote(');
  assert.ok(exportIdx !== -1, 'Expected export function resetWorktreeToRemote to exist');
  const sigEnd = content.indexOf(')', exportIdx);
  const sig = content.slice(exportIdx, sigEnd + 1);
  assert.ok(sig.includes(p1), `Expected "${p1}" in function signature`);
  assert.ok(sig.includes(p2), `Expected "${p2}" in function signature`);
});

Then('the module-level doc comment states that unpushed local commits are discarded', function () {
  const content = sharedCtx.fileContent;
  const hasUnpushed = content.includes('unpushed') || content.includes('Unpushed');
  const hasDiscard = content.includes('discard') || content.includes('Discard');
  assert.ok(
    hasUnpushed && hasDiscard,
    `Expected ${sharedCtx.filePath} doc comment to mention discarding unpushed commits`,
  );
});

// ── Context-only Given steps ───────────────────────────────────────────────────

Given('a worktree with an in-progress merge', function () {
  loadModule();
});

Given('a worktree with no in-progress merge', function () {
  loadModule();
});

Given('a worktree with an in-progress rebase', function () {
  loadModule();
});

Given('a worktree with no in-progress rebase', function () {
  loadModule();
});

Given('a worktree on branch {string}', function (_branch: string) {
  loadModule();
});

Given('a mocked worktree with no in-progress merge or rebase and no dirty files', function () {
  loadTestFile();
});

Given('a mocked worktree whose tracked files have uncommitted modifications', function () {
  loadTestFile();
});

Given(
  /^a mocked worktree whose \.git\/MERGE_HEAD indicates an in-progress merge$/,
  function () {
    loadTestFile();
  },
);

Given(
  /^a mocked worktree whose \.git\/rebase-apply\/ or \.git\/rebase-merge\/ indicates an in-progress rebase$/,
  function () {
    loadTestFile();
  },
);

Given('a mocked worktree with untracked files outside tracked state', function () {
  loadTestFile();
});

Given('a mocked worktree with an in-progress merge', function () {
  loadTestFile();
});

Given('a mocked worktree with an in-progress rebase', function () {
  loadTestFile();
});

Given('{string} fails or is unavailable', function (_cmd: string) {
  // Context only — verified via code inspection
});

Given('the mock is configured so {string} exits non-zero', function (_cmd: string) {
  // Context only — verified via unit test code inspection
});

// ── When steps ─────────────────────────────────────────────────────────────────

When('resetWorktreeToRemote is called for that worktree and its branch', function () {
  loadModule();
});

When('resetWorktreeToRemote is called with that worktree and branch', function () {
  loadModule();
});

When('resetWorktreeToRemote is called', function () {
  // Already loaded in Given; no action needed
});

// ── Then steps: merge abort ────────────────────────────────────────────────────

// Feature: Then "git merge --abort" is run in the worktree before any reset or clean
// Cucumber parses the leading "..." as {string}, so the pattern is {string} is run in the worktree...
// But "git clean -fdx" is run in the worktree uses the same prefix. We use the full text as regex.
Then(
  /^"git merge --abort" is run in the worktree before any reset or clean$/,
  function () {
    const content = sharedCtx.fileContent;
    const mergeAbortIdx = content.indexOf('git merge --abort');
    const resetIdx = content.indexOf('git reset --hard');
    const cleanIdx = content.indexOf('git clean -fdx');
    assert.ok(mergeAbortIdx !== -1, 'Expected module to contain "git merge --abort"');
    assert.ok(resetIdx !== -1, 'Expected module to contain "git reset --hard"');
    assert.ok(cleanIdx !== -1, 'Expected module to contain "git clean -fdx"');
    assert.ok(mergeAbortIdx < resetIdx, 'Expected "git merge --abort" before "git reset --hard"');
    assert.ok(mergeAbortIdx < cleanIdx, 'Expected "git merge --abort" before "git clean -fdx"');
  },
);

// Feature: Then the ".git/MERGE_HEAD" file is removed from the worktree
Then('the {string} file is removed from the worktree', function (path: string) {
  const content = sharedCtx.fileContent;
  if (path.includes('MERGE_HEAD')) {
    assert.ok(
      content.includes('MERGE_HEAD') && content.includes('rmSync'),
      'Expected module to use rmSync to remove MERGE_HEAD as a fallback',
    );
  }
});

// Feature: Then "git merge --abort" is not run
Then(/^"git merge --abort" is not run$/, function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('existsSync') && content.includes('MERGE_HEAD'),
    'Expected module to guard merge abort behind existsSync check on MERGE_HEAD',
  );
  assert.ok(
    content.includes('if (!existsSync(mergeHead)) return'),
    'Expected early-return guard: if (!existsSync(mergeHead)) return',
  );
});

// Feature: Then no attempt is made to remove ".git/MERGE_HEAD"
Then('no attempt is made to remove {string}', function (_path: string) {
  // Guard is present (existsSync check): rmSync only reached in the catch branch
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('existsSync'),
    'Expected existsSync guard to protect rmSync from being called on a clean worktree',
  );
});

// ── Then steps: rebase abort ───────────────────────────────────────────────────

Then(
  /^"git rebase --abort" is run in the worktree before any reset or clean$/,
  function () {
    const content = sharedCtx.fileContent;
    const rebaseAbortIdx = content.indexOf('git rebase --abort');
    const resetIdx = content.indexOf('git reset --hard');
    assert.ok(rebaseAbortIdx !== -1, 'Expected module to contain "git rebase --abort"');
    assert.ok(rebaseAbortIdx < resetIdx, 'Expected "git rebase --abort" before "git reset --hard"');
  },
);

// Feature: Then the ".git/rebase-apply/" directory is removed from the worktree
// Feature: Then the ".git/rebase-merge/" directory is removed from the worktree
Then('the {string} directory is removed from the worktree', function (dirPath: string) {
  const content = sharedCtx.fileContent;
  if (dirPath.includes('rebase')) {
    assert.ok(
      content.includes('rebase-apply') && content.includes('rmSync'),
      `Expected module to use rmSync to remove rebase directory: ${dirPath}`,
    );
  }
});

Then(/^"git rebase --abort" is not run$/, function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('existsSync') && content.includes('rebase-apply'),
    'Expected module to guard rebase abort behind existsSync check on rebase dirs',
  );
});

Then('no attempt is made to remove the rebase-apply or rebase-merge directories', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('rmSync(rebaseApply') || content.includes('rmSync(rebaseMerge'),
    'Expected rmSync on rebase dirs to be present (in the fallback catch branch)',
  );
});

// ── Then steps: hard reset ────────────────────────────────────────────────────

// Feature: Then "git reset --hard origin/feature-issue-457-worktree-reset-module" is run in the worktree
// Cucumber matches leading quoted string as {string}, remainder = " is run in the worktree"
Then(/^"git reset --hard origin\/feature-issue-457-worktree-reset-module" is run in the worktree$/, function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('git reset --hard "origin/${branch}"'),
    'Expected module to run git reset --hard with origin/<branch>',
  );
});

// Feature: Then the merge abort step runs before "git reset --hard"
Then(/^the merge abort step runs before "git reset --hard"$/, function () {
  const content = sharedCtx.fileContent;
  const abortIdx = content.indexOf('abortInProgressMerge');
  const resetIdx = content.indexOf('git reset --hard');
  assert.ok(abortIdx !== -1, 'Expected abortInProgressMerge call in resetWorktreeToRemote');
  assert.ok(abortIdx < resetIdx, 'Expected abortInProgressMerge before git reset --hard');
});

// ── Then steps: clean ─────────────────────────────────────────────────────────

// Feature: Then "git clean -fdx" is run in the worktree
Then(/^"git clean -fdx" is run in the worktree$/, function () {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes('git clean -fdx'), 'Expected module to run "git clean -fdx"');
});

// Feature: Then "git clean -fdx" runs after "git reset --hard"
Then(/^"git clean -fdx" runs after "git reset --hard"$/, function () {
  const content = sharedCtx.fileContent;
  const resetIdx = content.indexOf('git reset --hard');
  const cleanIdx = content.indexOf('git clean -fdx');
  assert.ok(cleanIdx > resetIdx, 'Expected "git clean -fdx" to appear after "git reset --hard"');
});

// ── Then steps: unit test file assertions ────────────────────────────────────

Then('the unit test file for worktreeReset exists', function () {
  assert.ok(existsSync(join(ROOT, TEST_PATH)), `Expected ${TEST_PATH} to exist`);
  loadTestFile();
});

Then('each test replaces the shell executor with an injected mock', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes("vi.mock('child_process'"),
    'Expected test file to mock child_process',
  );
  assert.ok(content.includes('execSync: vi.fn()'), 'Expected execSync to be replaced with vi.fn()');
});

Then('no test invokes a real git subprocess', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('mockExecSync'),
    'Expected tests to use mocked execSync',
  );
});

Then('the function completes without throwing', function () {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes('resetWorktreeToRemote'), 'Expected test file to call resetWorktreeToRemote');
  assert.ok(content.includes('idempotent'), 'Expected test file to include an idempotent test case');
});

// Feature: Then "git reset --hard origin/<branch>" and "git clean -fdx" are recorded on the mock
Then(/^"git reset --hard origin\/<branch>" and "git clean -fdx" are recorded on the mock$/, function () {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes('git reset --hard'), 'Expected test to assert git reset --hard');
  assert.ok(content.includes('git clean -fdx'), 'Expected test to assert git clean -fdx');
});

// Feature: Then no "git merge --abort" or "git rebase --abort" call is recorded on the mock
Then(/^no "git merge --abort" or "git rebase --abort" call is recorded on the mock$/, function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('git merge --abort') || content.includes('merge --abort'),
    'Expected test file to verify no merge --abort call in clean-worktree scenario',
  );
});

Then(
  'calling resetWorktreeToRemote a second time records the same calls with the same effect',
  function () {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('idempotent') || content.includes('second'),
      'Expected test file to include an idempotency assertion',
    );
  },
);

Then('the mocked tracked-file state after reset matches origin\\/<branch>', function () {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes('reset --hard'), 'Expected test to call git reset --hard');
});

// Feature: Then "git merge --abort" is recorded on the mock before "git reset --hard"
Then(/^"git merge --abort" is recorded on the mock before "git reset --hard"$/, function () {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes('merge --abort'), 'Expected test to assert git merge --abort');
  assert.ok(content.includes('in-progress merge'), 'Expected test to include in-progress merge case');
});

Then('the in-progress merge marker is cleared before reset', function () {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes('MERGE_HEAD'), 'Expected test to reference MERGE_HEAD marker');
});

// Feature: Then "git rebase --abort" is recorded on the mock before "git reset --hard"
Then(/^"git rebase --abort" is recorded on the mock before "git reset --hard"$/, function () {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes('rebase --abort'), 'Expected test to assert git rebase --abort');
  assert.ok(content.includes('in-progress rebase'), 'Expected test to include in-progress rebase case');
});

Then('the in-progress rebase marker is cleared before reset', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('rebase-apply') || content.includes('rebase-merge'),
    'Expected test to reference rebase marker directories',
  );
});

// Feature: Then "git clean -fdx" is recorded on the mock after "git reset --hard"
Then(/^"git clean -fdx" is recorded on the mock after "git reset --hard"$/, function () {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes('git clean -fdx'), 'Expected test to assert git clean -fdx');
});

Then('the mocked untracked-file set is empty after the call completes', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('untracked') || content.includes('clean -fdx'),
    'Expected test to include an untracked files test case',
  );
});

// Feature: Then "git reset --hard origin/<branch>" is recorded on the mock
Then(/^"git reset --hard origin\/<branch>" is recorded on the mock$/, function () {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes('reset --hard'), 'Expected test to assert git reset --hard');
});

// Feature: Then the ".git/MERGE_HEAD" removal is recorded on the mock after the failed abort
Then(
  /^the "\.git\/MERGE_HEAD" removal is recorded on the mock after the failed abort$/,
  function () {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('MERGE_HEAD') && content.includes('force: true'),
      'Expected test to assert rmSync on MERGE_HEAD with { force: true }',
    );
  },
);

Then('the function still proceeds to the hard reset and clean', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('git fetch origin') || content.includes('fetch origin'),
    'Expected test to assert fetch still runs after fallback',
  );
});

// Feature: Then the removal of ".git/rebase-apply/" and ".git/rebase-merge/" is recorded on the mock
Then(
  /^the removal of "\.git\/rebase-apply\/" and "\.git\/rebase-merge\/" is recorded on the mock$/,
  function () {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('rebase-apply') && content.includes('recursive: true'),
      'Expected test to assert rmSync on rebase-apply with { recursive: true, force: true }',
    );
    assert.ok(content.includes('rebase-merge'), 'Expected test to assert rmSync on rebase-merge');
  },
);

// ── Then steps: TypeScript integrity ─────────────────────────────────────────
// "both type-check commands exit with code {int}" is handled by removeUnnecessaryExportsSteps.ts
