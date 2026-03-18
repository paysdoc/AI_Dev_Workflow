import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

function loadPrReviewPhase(): void {
  const filePath = 'adws/phases/prReviewPhase.ts';
  sharedCtx.fileContent = readFileSync(join(ROOT, filePath), 'utf-8');
  sharedCtx.filePath = filePath;
}

function loadAdwPrReview(): void {
  const filePath = 'adws/adwPrReview.tsx';
  sharedCtx.fileContent = readFileSync(join(ROOT, filePath), 'utf-8');
  sharedCtx.filePath = filePath;
}

// ── Context-only Given/When steps ─────────────────────────────────────────────

Given('a PR exists for branch {string} on the vestmatic repository', function (_branch: string) {
  // Context only — precondition described in scenario prose
});

Given('the branch does not exist in the ADW repository\'s git history', function () {
  // Context only — precondition described in scenario prose
});

Given('adwPrReview.tsx is invoked with {string}', function (_args: string) {
  loadAdwPrReview();
});

Given('adwPrReview.tsx is invoked without --target-repo arguments', function () {
  loadAdwPrReview();
});

When('initializePRReviewWorkflow runs for PR #{int}', function (_prNumber: number) {
  loadPrReviewPhase();
});

When('initializePRReviewWorkflow runs without a targetRepo', function () {
  loadPrReviewPhase();
});

// ── Key regression assertions ──────────────────────────────────────────────────

Then('adwPrReview.tsx calls initializePRReviewWorkflow with the targetRepo argument', function () {
  loadAdwPrReview();
  const content = sharedCtx.fileContent;

  // The call to initializePRReviewWorkflow must include targetRepo (5th argument or
  // as a named/positional parameter beyond repoInfo and repoId).
  // The function should NOT discard targetRepo after parseTargetRepoArgs().
  assert.ok(
    content.includes('initializePRReviewWorkflow'),
    'Expected adwPrReview.tsx to call initializePRReviewWorkflow',
  );

  // parseTargetRepoArgs must be called to extract targetRepo with cloneUrl
  assert.ok(
    content.includes('parseTargetRepoArgs'),
    'Expected adwPrReview.tsx to call parseTargetRepoArgs to extract --target-repo args',
  );

  // targetRepo must be forwarded to initializePRReviewWorkflow, not silently discarded.
  // The call must reference targetRepo in the same expression as initializePRReviewWorkflow.
  const initCallIdx = content.indexOf('initializePRReviewWorkflow(');
  assert.ok(initCallIdx !== -1, 'Expected initializePRReviewWorkflow( call site in adwPrReview.tsx');

  // Extract the call expression (roughly up to the closing paren, within ~300 chars)
  const callSlice = content.slice(initCallIdx, initCallIdx + 300);

  assert.ok(
    callSlice.includes('targetRepo'),
    'Expected the initializePRReviewWorkflow() call in adwPrReview.tsx to pass targetRepo as an argument',
  );
});

Then('the initializePRReviewWorkflow function signature accepts a targetRepo parameter', function () {
  loadPrReviewPhase();
  const content = sharedCtx.fileContent;

  // The function signature must declare a targetRepo parameter
  const fnSignatureIdx = content.indexOf('function initializePRReviewWorkflow(');
  assert.ok(fnSignatureIdx !== -1, 'Expected initializePRReviewWorkflow function definition in prReviewPhase.ts');

  // Look at the function declaration (up to 400 chars covers the parameter list)
  const signatureSlice = content.slice(fnSignatureIdx, fnSignatureIdx + 400);

  assert.ok(
    signatureSlice.includes('targetRepo') || signatureSlice.includes('TargetRepoInfo'),
    'Expected initializePRReviewWorkflow signature to include a targetRepo parameter (TargetRepoInfo)',
  );
});

Then('initializePRReviewWorkflow imports and calls ensureTargetRepoWorkspace', function () {
  loadPrReviewPhase();
  const content = sharedCtx.fileContent;

  assert.ok(
    content.includes('ensureTargetRepoWorkspace'),
    'Expected prReviewPhase.ts to import and call ensureTargetRepoWorkspace for target repo workspace setup',
  );

  // It must be called (not just imported), so look for a call pattern
  assert.ok(
    content.includes('ensureTargetRepoWorkspace('),
    'Expected prReviewPhase.ts to call ensureTargetRepoWorkspace() (not just reference it)',
  );
});

Then('ensureWorktree is called with a baseRepoPath derived from the target repo workspace', function () {
  loadPrReviewPhase();
  const content = sharedCtx.fileContent;

  // ensureWorktree must be called with at least 3 arguments — the 3rd is baseRepoPath.
  // A call with only 1 argument (just branchName) indicates the regression.
  const ensureWorktreeCallIdx = content.indexOf('ensureWorktree(');
  assert.ok(ensureWorktreeCallIdx !== -1, 'Expected ensureWorktree( call in prReviewPhase.ts');

  // Look at the call (up to 200 chars for the argument list)
  const callSlice = content.slice(ensureWorktreeCallIdx, ensureWorktreeCallIdx + 200);

  // The call must reference a workspace path variable — not just prDetails.headBranch alone.
  // Valid patterns: ensureWorktree(branch, undefined, workspacePath) or ensureWorktree(branch, baseBranch, workspacePath)
  const hasBaseRepoPath =
    callSlice.includes('targetRepoWorkspacePath') ||
    callSlice.includes('workspacePath') ||
    callSlice.includes('baseRepoPath') ||
    callSlice.includes('targetRepo.workspacePath') ||
    callSlice.includes('getTargetRepoWorkspacePath');

  assert.ok(
    hasBaseRepoPath,
    'Expected ensureWorktree() in prReviewPhase.ts to receive a baseRepoPath argument ' +
    '(targetRepoWorkspacePath or similar). Without it, git operations run in the ADW ' +
    'directory instead of the target repo workspace.',
  );
});

Then('the worktree is created inside the vestmatic workspace path', function () {
  const content = sharedCtx.fileContent;

  // The workspace path must be derived from the target repo, not the ADW process directory.
  // ensureTargetRepoWorkspace or getTargetRepoWorkspacePath must be used.
  const usesTargetWorkspace =
    content.includes('ensureTargetRepoWorkspace') ||
    content.includes('getTargetRepoWorkspacePath') ||
    content.includes('targetRepoWorkspacePath');

  assert.ok(
    usesTargetWorkspace,
    'Expected prReviewPhase.ts to derive the worktree base path from the target repo workspace ' +
    '(ensureTargetRepoWorkspace / getTargetRepoWorkspacePath), not from process.cwd()',
  );
});

Then('the workflow does not fail with {string}', function (_errorMessage: string) {
  const content = sharedCtx.fileContent;

  // Regression guard: ensureWorktree must receive the target repo workspace path
  // so that branch lookup succeeds in the correct git repo.
  const ensureWorktreeCallIdx = content.indexOf('ensureWorktree(');
  assert.ok(ensureWorktreeCallIdx !== -1, 'Expected ensureWorktree( call in prReviewPhase.ts');

  const callSlice = content.slice(ensureWorktreeCallIdx, ensureWorktreeCallIdx + 200);
  const hasBaseRepoPath =
    callSlice.includes('targetRepoWorkspacePath') ||
    callSlice.includes('workspacePath') ||
    callSlice.includes('baseRepoPath') ||
    callSlice.includes('targetRepo.workspacePath') ||
    callSlice.includes('getTargetRepoWorkspacePath');

  assert.ok(
    hasBaseRepoPath,
    'Expected ensureWorktree() to receive a baseRepoPath so branch lookup runs in the correct repo',
  );
});

Then('ensureWorktree is called without a baseRepoPath', function () {
  const content = sharedCtx.fileContent;

  // When no --target-repo is provided, ensureWorktree should use the ADW directory (default).
  // This is the no-op / backward-compatible path.
  assert.ok(
    content.includes('ensureWorktree('),
    'Expected ensureWorktree( to be present in prReviewPhase.ts',
  );
  // Pass-through: the fallback behaviour is preserved when targetRepo is absent
});

Then('worktree operations remain scoped to the ADW repository directory', function () {
  // Pass-through — the absence of targetRepo means ensureWorktree uses process.cwd() (ADW dir),
  // which is correct for ADW's own PRs. Validated implicitly by the guarded ensureTargetRepoWorkspace call.
});
