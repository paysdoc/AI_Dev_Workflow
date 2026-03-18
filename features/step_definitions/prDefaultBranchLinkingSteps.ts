import { Then } from '@cucumber/cucumber';
import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();

function loadFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf-8');
}

// ── runPullRequestAgent signature checks ────────────────────────────────────

Then('the runPullRequestAgent function signature includes a repoOwner parameter', function () {
  const content = loadFile('adws/agents/prAgent.ts');
  const fnIdx = content.indexOf('function runPullRequestAgent(');
  if (fnIdx === -1) {
    // May be an export async function
    const altIdx = content.indexOf('async function runPullRequestAgent(');
    assert.ok(altIdx !== -1, 'Expected runPullRequestAgent function definition in prAgent.ts');
    const sig = content.slice(altIdx, altIdx + 600);
    assert.ok(
      sig.includes('repoOwner'),
      'Expected runPullRequestAgent signature to include repoOwner parameter',
    );
    return;
  }
  const sig = content.slice(fnIdx, fnIdx + 600);
  assert.ok(
    sig.includes('repoOwner'),
    'Expected runPullRequestAgent signature to include repoOwner parameter',
  );
});

Then('the runPullRequestAgent function signature includes a repoName parameter', function () {
  const content = loadFile('adws/agents/prAgent.ts');
  const fnMatch = content.match(/function runPullRequestAgent\(/);
  assert.ok(fnMatch, 'Expected runPullRequestAgent function definition in prAgent.ts');
  const fnIdx = content.indexOf(fnMatch[0]);
  const sig = content.slice(fnIdx, fnIdx + 600);
  assert.ok(
    sig.includes('repoName'),
    'Expected runPullRequestAgent signature to include repoName parameter',
  );
});

// ── formatPullRequestArgs checks ────────────────────────────────────────────

Then('formatPullRequestArgs includes repoOwner in its parameter list', function () {
  const content = loadFile('adws/agents/prAgent.ts');
  const fnIdx = content.indexOf('function formatPullRequestArgs(');
  assert.ok(fnIdx !== -1, 'Expected formatPullRequestArgs function definition in prAgent.ts');
  const sig = content.slice(fnIdx, fnIdx + 400);
  assert.ok(
    sig.includes('repoOwner'),
    'Expected formatPullRequestArgs to accept repoOwner parameter',
  );
});

Then('formatPullRequestArgs includes repoName in its parameter list', function () {
  const content = loadFile('adws/agents/prAgent.ts');
  const fnIdx = content.indexOf('function formatPullRequestArgs(');
  assert.ok(fnIdx !== -1, 'Expected formatPullRequestArgs function definition in prAgent.ts');
  const sig = content.slice(fnIdx, fnIdx + 400);
  assert.ok(
    sig.includes('repoName'),
    'Expected formatPullRequestArgs to accept repoName parameter',
  );
});

// ── prPhase.ts passes repo context ──────────────────────────────────────────

Then('the runPullRequestAgent call in prPhase.ts includes repo owner from repoContext', function () {
  const content = loadFile('adws/phases/prPhase.ts');
  const callIdx = content.indexOf('runPullRequestAgent(');
  assert.ok(callIdx !== -1, 'Expected runPullRequestAgent() call in prPhase.ts');
  const callSlice = content.slice(callIdx, callIdx + 400);

  // The call must reference repoContext or repoId owner/repo
  const hasRepoOwner =
    callSlice.includes('repoId.owner') ||
    callSlice.includes('repoContext.repoId.owner') ||
    callSlice.includes('owner') ||
    callSlice.includes('repoOwner');

  assert.ok(
    hasRepoOwner,
    'Expected runPullRequestAgent() call in prPhase.ts to pass repo owner from repoContext',
  );
});

Then('the runPullRequestAgent call in prPhase.ts includes repo name from repoContext', function () {
  const content = loadFile('adws/phases/prPhase.ts');
  const callIdx = content.indexOf('runPullRequestAgent(');
  assert.ok(callIdx !== -1, 'Expected runPullRequestAgent() call in prPhase.ts');
  const callSlice = content.slice(callIdx, callIdx + 400);

  const hasRepoName =
    callSlice.includes('repoId.repo') ||
    callSlice.includes('repoContext.repoId.repo') ||
    callSlice.includes('repoName');

  assert.ok(
    hasRepoName,
    'Expected runPullRequestAgent() call in prPhase.ts to pass repo name from repoContext',
  );
});

// ── generatePrBody qualified reference checks ───────────────────────────────

Then('generatePrBody uses repoOwner and repoName to build a qualified issue reference', function () {
  const content = loadFile('adws/github/pullRequestCreator.ts');
  const fnIdx = content.indexOf('function generatePrBody(');
  assert.ok(fnIdx !== -1, 'Expected generatePrBody function definition in pullRequestCreator.ts');
  const fnBody = content.slice(fnIdx, fnIdx + 800);

  // The function must accept repoOwner and repoName and combine them into owner/repo#N
  assert.ok(
    fnBody.includes('repoOwner') && fnBody.includes('repoName'),
    'Expected generatePrBody to accept repoOwner and repoName parameters',
  );

  // Must build a qualified reference using both params (e.g., `${repoOwner}/${repoName}#`)
  const hasQualifiedBuild =
    fnBody.includes('repoOwner') &&
    fnBody.includes('repoName') &&
    (fnBody.includes('/${') || fnBody.includes('`${'));

  assert.ok(
    hasQualifiedBuild,
    'Expected generatePrBody to build a qualified owner/repo#N issue reference when both params are provided',
  );
});

Then('generatePrBody falls back to bare issue reference when repo params are missing', function () {
  const content = loadFile('adws/github/pullRequestCreator.ts');
  const fnIdx = content.indexOf('function generatePrBody(');
  assert.ok(fnIdx !== -1, 'Expected generatePrBody function definition in pullRequestCreator.ts');
  const fnBody = content.slice(fnIdx, fnIdx + 800);

  // The function must have a conditional that falls back to bare #N
  // Look for ternary or if/else that produces `#${issue.number}` or `#${...number}`
  const hasFallback =
    fnBody.includes('`#${') ||
    fnBody.includes("'#' +") ||
    fnBody.includes('"#" +') ||
    fnBody.includes(': `#');

  assert.ok(
    hasFallback,
    'Expected generatePrBody to fall back to bare #N reference when repoOwner/repoName are absent',
  );
});

// ── createPullRequest signature checks ──────────────────────────────────────

Then('createPullRequest function signature includes repoOwner parameter', function () {
  const content = loadFile('adws/github/pullRequestCreator.ts');
  const fnMatch = content.match(/function createPullRequest\(/);
  assert.ok(fnMatch, 'Expected createPullRequest function definition in pullRequestCreator.ts');
  const fnIdx = content.indexOf(fnMatch[0]);
  const sig = content.slice(fnIdx, fnIdx + 600);
  assert.ok(
    sig.includes('repoOwner'),
    'Expected createPullRequest signature to include repoOwner parameter',
  );
});

Then('createPullRequest function signature includes repoName parameter', function () {
  const content = loadFile('adws/github/pullRequestCreator.ts');
  const fnMatch = content.match(/function createPullRequest\(/);
  assert.ok(fnMatch, 'Expected createPullRequest function definition in pullRequestCreator.ts');
  const fnIdx = content.indexOf(fnMatch[0]);
  const sig = content.slice(fnIdx, fnIdx + 600);
  assert.ok(
    sig.includes('repoName'),
    'Expected createPullRequest signature to include repoName parameter',
  );
});

// ── Qualified issue reference in slash command ──────────────────────────────

Then('the file contains {string} or instructs to use qualified issue references', function (this: Record<string, string>, partial: string) {
  const content = this.fileContent || loadFile('.claude/commands/pull_request.md');

  // Check for the literal string or for any instruction about qualified references
  const hasQualifiedRef =
    content.includes(partial) ||
    content.includes('owner/repo#') ||
    content.includes('repoOwner') && content.includes('repoName') && content.includes('#') ||
    content.includes('qualified') ||
    content.includes('fully-qualified') ||
    content.includes('<repoOwner>/<repoName>#');

  assert.ok(
    hasQualifiedRef,
    `Expected pull_request.md to contain "${partial}" or instruct using qualified issue references (owner/repo#N)`,
  );
});

Then('the file contains {string} or references defaultBranch variable without hardcoded main', function (this: Record<string, string>, partial: string) {
  const content = this.fileContent || loadFile('.claude/commands/pull_request.md');

  const hasDefaultBranchHandling =
    content.includes(partial) ||
    content.includes('defaultBranch') ||
    content.includes('gh repo view');

  assert.ok(
    hasDefaultBranchHandling,
    `Expected pull_request.md to contain "${partial}" or reference the defaultBranch variable for branch detection`,
  );
});
