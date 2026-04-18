import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

// Helper: extract the body of resumeWorkflow from source content
function getResumeWorkflowBody(content: string): string {
  const fnIdx = content.indexOf('async function resumeWorkflow(');
  assert.ok(fnIdx !== -1, 'Expected pauseQueueScanner.ts to define resumeWorkflow');
  // Walk braces to find function end
  let depth = 0;
  const start = content.indexOf('{', fnIdx);
  assert.ok(start !== -1, 'Expected resumeWorkflow to have an opening brace');
  let i = start;
  while (i < content.length) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return content.slice(fnIdx, i + 1);
    }
    i++;
  }
  return content.slice(fnIdx);
}

// ── 1. Child stdout/stderr is captured, not ignored ─────────────────────────

Then('the resumeWorkflow function does not pass {string} to spawn', function (forbidden: string) {
  const body = getResumeWorkflowBody(sharedCtx.fileContent);
  // Find the detached spawn call (not the worktree-missing branch which has no spawn)
  const spawnIdx = body.indexOf("spawn('bunx'");
  assert.ok(spawnIdx !== -1, 'Expected resumeWorkflow to call spawn');
  // Extract spawn options argument
  const afterSpawn = body.slice(spawnIdx, spawnIdx + 300);
  assert.ok(
    !afterSpawn.includes(forbidden),
    `Expected resumeWorkflow's spawn call NOT to include "${forbidden}", but found it`,
  );
});

Then('the resumeWorkflow function opens a per-resume log file and passes its file descriptors to spawn stdio', function () {
  const body = getResumeWorkflowBody(sharedCtx.fileContent);
  assert.ok(
    body.includes('openSync') || body.includes('fs.openSync'),
    'Expected resumeWorkflow to call fs.openSync to open a log file',
  );
  // stdio should be an array (not the string 'ignore')
  const spawnIdx = body.indexOf("spawn('bunx'");
  assert.ok(spawnIdx !== -1, 'Expected resumeWorkflow to call spawn');
  const afterSpawn = body.slice(spawnIdx, spawnIdx + 300);
  assert.ok(
    afterSpawn.includes("stdio: ['ignore'") || afterSpawn.includes('stdio: ['),
    'Expected resumeWorkflow spawn to use an array stdio option with file descriptors',
  );
});

Then('the per-resume log file path contains the entry adwId so concurrent resumes do not collide', function () {
  const body = getResumeWorkflowBody(sharedCtx.fileContent);
  assert.ok(
    body.includes('entry.adwId') && (body.includes('.resume.log') || body.includes('resumeLog')),
    'Expected resumeWorkflow to incorporate entry.adwId into the per-resume log file path',
  );
});

// ── 2. Child is spawned in the target-repo worktree ─────────────────────────

Then('the resumeWorkflow function passes {string} to spawn', function (cwdExpr: string) {
  const body = getResumeWorkflowBody(sharedCtx.fileContent);
  const spawnIdx = body.indexOf("spawn('bunx'");
  assert.ok(spawnIdx !== -1, 'Expected resumeWorkflow to call spawn');
  const afterSpawn = body.slice(spawnIdx, spawnIdx + 300);
  assert.ok(
    afterSpawn.includes(cwdExpr),
    `Expected resumeWorkflow spawn options to include "${cwdExpr}"`,
  );
});

Then('the spawn options object in resumeWorkflow contains a cwd property', function () {
  const body = getResumeWorkflowBody(sharedCtx.fileContent);
  const spawnIdx = body.indexOf("spawn('bunx'");
  assert.ok(spawnIdx !== -1, 'Expected resumeWorkflow to call spawn');
  const afterSpawn = body.slice(spawnIdx, spawnIdx + 300);
  assert.ok(
    afterSpawn.includes('cwd:'),
    'Expected resumeWorkflow spawn options to include a cwd property',
  );
});

// ── 3. Queue entry is not removed until spawn is confirmed ──────────────────

Then('in resumeWorkflow {string} appears before {string}', function (first: string, second: string) {
  const body = getResumeWorkflowBody(sharedCtx.fileContent);
  const firstIdx = body.indexOf(first);
  assert.ok(firstIdx !== -1, `Expected resumeWorkflow to contain "${first}"`);
  // Find the occurrence of `second` that comes AFTER `first` (there may be earlier occurrences in other branches)
  const secondIdx = body.indexOf(second, firstIdx);
  assert.ok(
    secondIdx !== -1,
    `Expected "${second}" to appear after "${first}" (at ${firstIdx}) in resumeWorkflow`,
  );
});

Then('resumeWorkflow registers a child {string} listener that keeps the entry in the pause queue', function (event: string) {
  const body = getResumeWorkflowBody(sharedCtx.fileContent);
  assert.ok(
    body.includes(`'${event}'`) || body.includes(`"${event}"`),
    `Expected resumeWorkflow to register a child "${event}" listener`,
  );
  // Confirm the failure path calls updatePauseQueueEntry (keeps entry) not removeFromPauseQueue
  // by checking that updatePauseQueueEntry appears after the error/exit listener setup
  const errorListenerIdx = body.indexOf(`'${event}'`);
  const updateIdx = body.indexOf('updatePauseQueueEntry', errorListenerIdx);
  assert.ok(
    updateIdx !== -1,
    `Expected resumeWorkflow to call updatePauseQueueEntry after registering the "${event}" listener`,
  );
});

Then('resumeWorkflow waits for the child {string} event or a short delay before calling removeFromPauseQueue', function (_event: string) {
  const body = getResumeWorkflowBody(sharedCtx.fileContent);
  // awaitChildReadiness (or equivalent) must appear before removeFromPauseQueue
  const awaitIdx = body.indexOf('awaitChildReadiness') !== -1
    ? body.indexOf('awaitChildReadiness')
    : body.indexOf('setTimeout');
  // The worktree-missing early return also calls removeFromPauseQueue — find the one inside spawn block
  // by looking for the second occurrence (after spawn)
  const spawnIdx = body.indexOf("spawn('bunx'");
  const removeAfterSpawnIdx = body.indexOf('removeFromPauseQueue(entry.adwId)', spawnIdx);
  assert.ok(
    awaitIdx !== -1,
    'Expected resumeWorkflow to use awaitChildReadiness or setTimeout before removeFromPauseQueue',
  );
  assert.ok(
    removeAfterSpawnIdx === -1 || awaitIdx < removeAfterSpawnIdx,
    'Expected awaitChildReadiness to appear before removeFromPauseQueue in the spawn path',
  );
});

Then('the worktree-missing branch in resumeWorkflow still calls removeFromPauseQueue\\(entry.adwId) because manual restart is required', function () {
  const body = getResumeWorkflowBody(sharedCtx.fileContent);
  // The worktree-missing branch should contain removeFromPauseQueue before the spawn block
  const worktreeMissingIdx = body.indexOf('worktree gone') !== -1
    ? body.indexOf('worktree gone')
    : body.indexOf('worktreeExists');
  assert.ok(worktreeMissingIdx !== -1, 'Expected resumeWorkflow to have a worktree-missing branch');
  const removeInMissingBranch = body.indexOf('removeFromPauseQueue(entry.adwId)', worktreeMissingIdx);
  assert.ok(
    removeInMissingBranch !== -1,
    'Expected the worktree-missing branch to call removeFromPauseQueue(entry.adwId)',
  );
});

// ── 4. extraArgs (--target-repo) still flows through on resume ──────────────

Then('the spawn arguments in resumeWorkflow include the spread {string}', function (spread: string) {
  const body = getResumeWorkflowBody(sharedCtx.fileContent);
  assert.ok(
    body.includes(spread),
    `Expected resumeWorkflow spawn arguments to include "${spread}"`,
  );
});

// ── 5. Logging distinguishes spawn success from spawn attempt ────────────────

Then('resumeWorkflow emits a second log line after the child has reached an alive state or after spawn error', function () {
  const body = getResumeWorkflowBody(sharedCtx.fileContent);
  // Count log( calls in the function body (excluding comments)
  const logMatches = body.match(/\blog\(/g);
  assert.ok(
    logMatches && logMatches.length >= 2,
    `Expected resumeWorkflow to emit at least 2 log() calls, found ${logMatches?.length ?? 0}`,
  );
});

Then('resumeWorkflow logs the per-resume log file path so operators can inspect child startup output', function () {
  const body = getResumeWorkflowBody(sharedCtx.fileContent);
  // The failure path must log the resumeLogPath variable
  assert.ok(
    body.includes('resumeLogPath') && body.includes('log('),
    'Expected resumeWorkflow to log the resumeLogPath in the failure branch',
  );
  // Confirm resumeLogPath appears in a log call (not just in openSync)
  const logCallIdx = body.indexOf('log(`Resume spawn failed');
  assert.ok(
    logCallIdx !== -1,
    'Expected resumeWorkflow to log a "Resume spawn failed" message with the log file path',
  );
});
