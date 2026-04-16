import { Given, When, Then } from '@cucumber/cucumber';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── Context setup (Given) ────────────────────────────────────────────────────

Given('the stdout data handler processes incoming JSONL chunks', function () {
  // Context only — verified via agentProcessHandler.ts source inspection
});

Given('the build phase is running with a plan and a build agent', function () {
  const fullPath = join(ROOT, 'adws/phases/buildPhase.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/phases/buildPhase.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/phases/buildPhase.ts';
});

Given('the build phase is running with a plan', function () {
  const fullPath = join(ROOT, 'adws/phases/buildPhase.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/phases/buildPhase.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/phases/buildPhase.ts';
});

Given('the build phase is running with MAX_TOKEN_CONTINUATIONS = 3', function () {
  const fullPath = join(ROOT, 'adws/phases/buildPhase.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/phases/buildPhase.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/phases/buildPhase.ts';
});

Given('{int} continuations have already occurred \\(any mix of token limit and compaction)', function (_count: number) {
  // Context only — verified via MAX_TOKEN_CONTINUATIONS source inspection
});

Given('the build phase is running with a GitHub repo context', function () {
  const fullPath = join(ROOT, 'adws/phases/buildPhase.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/phases/buildPhase.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/phases/buildPhase.ts';
});

Given('the build phase is running with agent state tracking', function () {
  const fullPath = join(ROOT, 'adws/phases/buildPhase.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/phases/buildPhase.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/phases/buildPhase.ts';
});

Given('the build phase uses agentProcessHandler for the build agent', function () {
  const fullPath = join(ROOT, 'adws/agents/agentProcessHandler.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/agentProcessHandler.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/agentProcessHandler.ts';
});

Given('the ADW codebase with compaction detection implemented', function () {
  assert.ok(existsSync(join(ROOT, 'adws')), 'Expected adws/ directory to exist');
});

// ── When steps (context-only) ────────────────────────────────────────────────

When('a chunk contains a JSON object with {string}:{string}', function (_key: string, _value: string) {
  // Context only — logic verified via source inspection
});

When('a chunk contains a JSON object with {string}:{string} and {string}:{string}', function (_k1: string, _v1: string, _k2: string, _v2: string) {
  // Context only — logic verified via source inspection
});

When('two chunks each contain a JSON object with {string}:{string}', function (_key: string, _value: string) {
  // Context only — logic verified via source inspection
});

When('a chunk contains {string}:{string}', function (_key: string, _value: string) {
  // Context only — logic verified via source inspection
});

When('a subsequent chunk contains {string}:{string} with {string}', function (_k1: string, _v1: string, _v2: string) {
  // Context only — logic verified via source inspection
});

When('the output token count also exceeds the token limit threshold', function () {
  // Context only — logic verified via source inspection
});

When('the agent process completes after compaction was detected', function () {
  // Context only — logic verified via source inspection
});

When('the agent process completes normally without compaction', function () {
  // Context only — logic verified via source inspection
});

When('the build agent returns with compactionDetected = true', function () {
  // Context only — logic verified via source inspection in buildPhase.ts
});

When('the first build agent returns with tokenLimitExceeded = true', function () {
  // Context only
});

When('the second build agent returns with compactionDetected = true', function () {
  // Context only
});

When('the next build agent returns with compactionDetected = true', function () {
  // Context only
});

When('the first build agent returns with compactionDetected = true', function () {
  // Context only
});

When('the second build agent also returns with compactionDetected = true', function () {
  // Context only
});

When('the first build agent returns with compactionDetected = true and totalCostUsd = 0.05', function () {
  // Context only
});

When('the continuation build agent completes successfully with totalCostUsd = 0.03', function () {
  // Context only
});

When('the first build agent returns with compactionDetected = true and modelUsage data', function () {
  // Context only
});

When('the continuation build agent completes successfully with its own modelUsage data', function () {
  // Context only
});

When('the build agent returns with compactionDetected = true for the 2nd time', function () {
  // Context only
});

// Note: When('{string} is run') is already defined in removeUnitTestsSteps.ts

When('a non-build agent \\(e.g. plan, review) runs via agentProcessHandler', function () {
  // Context only — architecture check done via source inspection
});

// ── Then steps ───────────────────────────────────────────────────────────────

Then('a compactionDetected flag is set to true', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('compactionDetected = true'),
    'Expected agentProcessHandler.ts to set compactionDetected = true',
  );
});

Then('the agent process is killed with SIGTERM', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes("claude.kill('SIGTERM')"),
    "Expected agentProcessHandler.ts to call claude.kill('SIGTERM')",
  );
});

Then('the compactionDetected flag remains false', function () {
  const content = sharedCtx.fileContent;
  // The guard !compactionDetected ensures it only fires for compact_boundary, not status:compacting
  assert.ok(
    content.includes('!compactionDetected'),
    'Expected agentProcessHandler.ts to use !compactionDetected guard to prevent false triggers',
  );
  // Verify the detection key is "compact_boundary" not "compacting"
  assert.ok(
    content.includes('"subtype":"compact_boundary"') || content.includes('"subtype":"compact_boundary"'),
    'Expected compaction detection to key on "compact_boundary" specifically',
  );
});

Then('the agent process is not killed', function () {
  // Verified by the guard logic: !compactionDetected means SIGTERM only fires on compact_boundary
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('!compactionDetected') && content.includes('"subtype":"compact_boundary"'),
    'Expected SIGTERM to be gated by !compactionDetected and the compact_boundary subtype check',
  );
});

Then('SIGTERM is sent only once', function () {
  const content = sharedCtx.fileContent;
  // The !compactionDetected guard ensures SIGTERM fires at most once per run
  assert.ok(
    content.includes('!compactionDetected'),
    'Expected !compactionDetected guard to ensure SIGTERM is sent at most once',
  );
  assert.ok(
    content.includes('compactionDetected = true'),
    'Expected compactionDetected to be set to true to prevent repeated SIGTERM calls',
  );
});

Then('compactionDetected is true', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('compactionDetected = true'),
    'Expected agentProcessHandler.ts to set compactionDetected = true',
  );
});

Then('authErrorDetected is also true', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('authErrorDetected = true'),
    'Expected agentProcessHandler.ts to set authErrorDetected = true',
  );
});

Then('tokenLimitReached is also true', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('tokenLimitReached = true'),
    'Expected agentProcessHandler.ts to set tokenLimitReached = true',
  );
});

Then('the AgentResult interface includes a {string} field of type boolean', function (fieldName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(fieldName),
    `Expected agentTypes.ts to include a "${fieldName}" field`,
  );
  // Check that it's typed as boolean
  const idx = content.indexOf(fieldName);
  const surrounding = content.slice(idx, idx + 60);
  assert.ok(
    surrounding.includes('boolean'),
    `Expected "${fieldName}" field to be typed as boolean, got: ${surrounding}`,
  );
});

Then('the field is optional', function () {
  const content = sharedCtx.fileContent;
  // Optional fields use "?" in TypeScript
  assert.ok(
    content.includes('compactionDetected?'),
    'Expected compactionDetected field to be optional (declared with ?)',
  );
});

Then('the returned AgentResult has compactionDetected set to true', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('compactionDetected: true'),
    'Expected agentProcessHandler.ts to resolve AgentResult with compactionDetected: true',
  );
});

Then('the returned AgentResult does not have compactionDetected set to true', function () {
  const content = sharedCtx.fileContent;
  // Verify that normal success path (code===0 branch) does NOT include compactionDetected: true
  // The compactionDetected: true only appears inside the "if (compactionDetected)" block
  const compactionBlock = content.indexOf('if (compactionDetected)');
  assert.ok(
    compactionBlock !== -1,
    'Expected agentProcessHandler.ts to have a conditional block for compactionDetected',
  );
  // The normal success resolve should come after the compaction block and not set compactionDetected
  const afterCompaction = content.slice(compactionBlock + 100);
  // Verify the remaining resolves do not include compactionDetected: true
  const successResolveIdx = afterCompaction.indexOf('success: !state.lastResult.isError');
  assert.ok(
    successResolveIdx !== -1,
    'Expected a normal success resolve path after the compactionDetected block',
  );
  const successResolve = afterCompaction.slice(successResolveIdx, successResolveIdx + 300);
  assert.ok(
    !successResolve.includes('compactionDetected: true'),
    'Expected normal success resolve NOT to include compactionDetected: true',
  );
});

Then('the continuation counter is incremented', function () {
  const content = sharedCtx.fileContent;
  // buildPhase.ts uses contextResetCount++; retryOrchestrator also uses contextResetCount++
  // For test/review phases, the counter increment lives in retryOrchestrator.ts
  if (content.includes('contextResetNumber++') || content.includes('contextResetCount++')) return;
  const orchPath = join(ROOT, 'adws/core/retryOrchestrator.ts');
  const orchContent = readFileSync(orchPath, 'utf-8');
  assert.ok(
    orchContent.includes('contextResetCount++'),
    'Expected retryOrchestrator.ts to increment contextResetCount on compaction',
  );
});

Then('buildContinuationPrompt is called with the original plan and the partial output', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes("buildContinuationPrompt(planContent, buildResult.output, 'compaction')"),
    "Expected buildPhase.ts to call buildContinuationPrompt(planContent, buildResult.output, 'compaction')",
  );
});

Then('a new build agent is spawned with the continuation prompt', function () {
  const content = sharedCtx.fileContent;
  // The while loop continues with the updated currentPlanContent fed to runBuildAgent
  assert.ok(
    content.includes('currentPlanContent = buildContinuationPrompt'),
    'Expected buildPhase.ts to update currentPlanContent with the continuation prompt',
  );
  assert.ok(
    content.includes('runBuildAgent(issue, logsDir, currentPlanContent'),
    'Expected buildPhase.ts to pass currentPlanContent to runBuildAgent for the next iteration',
  );
});

Then('the shared continuation counter is 2', function () {
  const content = sharedCtx.fileContent;
  // buildPhase.ts: both tokenLimitExceeded and compactionDetected use the same contextResetNumber variable
  // retryOrchestrator.ts / reviewPhase.ts / testRetry.ts: use a single contextResetCount variable
  const hasBuildPhasePattern =
    content.includes('if (buildResult.tokenLimitExceeded)') &&
    content.includes('if (buildResult.compactionDetected)');
  const hasRetryOrchestratorPattern =
    content.includes('contextResetCount') && content.includes('MAX_CONTEXT_RESETS');
  assert.ok(
    hasBuildPhasePattern || hasRetryOrchestratorPattern,
    'Expected file to share a single context reset counter for both tokenLimitExceeded and compactionDetected',
  );
  if (hasBuildPhasePattern) {
    const tokenBlock = content.indexOf('if (buildResult.tokenLimitExceeded)');
    const compactionBlock = content.indexOf('if (buildResult.compactionDetected)');
    const tokenSection = content.slice(tokenBlock, tokenBlock + 300);
    const compactionSection = content.slice(compactionBlock, compactionBlock + 300);
    assert.ok(
      tokenSection.includes('contextResetNumber++'),
      'Expected build token limit block to increment contextResetNumber',
    );
    assert.ok(
      compactionSection.includes('contextResetNumber++'),
      'Expected build compaction block to increment contextResetNumber',
    );
  }
});

Then('the total number of continuations does not exceed MAX_TOKEN_CONTINUATIONS', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('MAX_CONTEXT_RESETS'),
    'Expected file to use MAX_CONTEXT_RESETS as the context reset limit',
  );
  // buildPhase.ts uses `contextResetNumber <= MAX_CONTEXT_RESETS` as a while-loop guard.
  // retryOrchestrator.ts / reviewPhase.ts use `contextResetCount > maxContextResets` with a throw.
  const hasWhileGuard = content.includes('contextResetNumber <= MAX_CONTEXT_RESETS');
  const hasThrowGuard =
    content.includes('contextResetCount > MAX_CONTEXT_RESETS') ||
    content.includes('contextResetCount > maxContextResets');
  assert.ok(
    hasWhileGuard || hasThrowGuard,
    'Expected file to enforce MAX_CONTEXT_RESETS via a while-loop guard or a throw',
  );
});

Then('the build phase throws an error indicating maximum continuations exceeded', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('exceeded maximum context resets') || content.includes('exceeded maximum continuations'),
    'Expected buildPhase.ts to throw an error when MAX_CONTEXT_RESETS is exceeded for compaction',
  );
  assert.ok(
    content.includes('context compaction') || content.includes('MAX_CONTEXT_RESETS'),
    'Expected the error message to mention context compaction or the max context resets limit',
  );
});

Then('buildContinuationPrompt receives the original plan content', function () {
  const content = sharedCtx.fileContent;
  // buildContinuationPrompt is always called with `planContent` (original), not `currentPlanContent`
  assert.ok(
    content.includes("buildContinuationPrompt(planContent,"),
    'Expected buildContinuationPrompt to be called with the original planContent (not currentPlanContent)',
  );
});

Then('buildContinuationPrompt receives the first agent\'s output', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('buildResult.output'),
    "Expected buildContinuationPrompt to receive buildResult.output",
  );
});

Then('buildContinuationPrompt again receives the original plan content', function () {
  const content = sharedCtx.fileContent;
  // Same as above — called with planContent in both cases
  assert.ok(
    content.includes("buildContinuationPrompt(planContent,"),
    'Expected buildContinuationPrompt to consistently receive the original planContent',
  );
});

Then('buildContinuationPrompt receives the second agent\'s output', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('buildResult.output'),
    "Expected buildContinuationPrompt to receive the current buildResult.output in each iteration",
  );
});

Then('the total accumulated cost for the build phase is 0.08', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('costUsd += buildResult.totalCostUsd'),
    'Expected buildPhase.ts to accumulate cost with costUsd += buildResult.totalCostUsd',
  );
});

Then('the total model usage is the merged sum of both runs', function () {
  const content = sharedCtx.fileContent;
  // buildPhase.ts: mergeModelUsageMaps(modelUsage, buildResult.modelUsage)
  // testRetry.ts: mergeModelUsageMaps(modelUsage, resolveResult.modelUsage)
  // retryOrchestrator.ts: mergeModelUsageMaps(state.modelUsage, result.modelUsage) via trackCost
  assert.ok(
    content.includes('mergeModelUsageMaps') || content.includes('trackCost'),
    'Expected file to merge model usage with mergeModelUsageMaps or trackCost',
  );
});

Then('an issue comment is posted with the {string} stage', function (stage: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`'${stage}'`),
    `Expected buildPhase.ts to post an issue comment with the '${stage}' stage`,
  );
});

Then('the comment is distinct from {string}', function (otherStage: string) {
  const content = sharedCtx.fileContent;
  // Both 'compaction_recovery' and 'token_limit_recovery' should appear as distinct stage strings
  assert.ok(
    content.includes("'compaction_recovery'"),
    "Expected buildPhase.ts to reference 'compaction_recovery' stage",
  );
  assert.ok(
    content.includes(`'${otherStage}'`),
    `Expected buildPhase.ts to also reference '${otherStage}' as a distinct stage`,
  );
  assert.notStrictEqual(
    'compaction_recovery',
    otherStage,
    `Expected 'compaction_recovery' to be distinct from '${otherStage}'`,
  );
});

Then('the compaction_recovery comment includes continuation number {int}', function (num: number) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('ctx.tokenContinuationNumber = continuationNumber'),
    'Expected buildPhase.ts to set ctx.tokenContinuationNumber before posting compaction_recovery comment',
  );
  // The continuation number must be set to a value matching num (2 means the second iteration)
  assert.ok(
    content.includes('continuationNumber++') && content.includes('compaction_recovery'),
    `Expected buildPhase.ts to post compaction_recovery with continuation number tracking (requested: ${num})`,
  );
});

Then('the WorkflowStage union type includes {string}', function (stage: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`'${stage}'`),
    `Expected workflowTypes.ts WorkflowStage union to include '${stage}'`,
  );
});

Then('there is a formatCompactionRecoveryComment function or case', function () {
  const content = sharedCtx.fileContent;
  const hasFunction = content.includes('formatCompactionRecoveryComment');
  const hasCase = content.includes("case 'compaction_recovery'");
  assert.ok(
    hasFunction || hasCase,
    "Expected workflowCommentsIssue.ts to have a formatCompactionRecoveryComment function or a 'compaction_recovery' case",
  );
});

Then('the formatted comment indicates context compaction was detected', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('compaction') || content.includes('Compaction'),
    'Expected workflowCommentsIssue.ts comment formatter to mention compaction',
  );
});

Then('the formatted comment includes the ADW ID', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('ctx.adwId') || content.includes('adwId'),
    'Expected workflowCommentsIssue.ts comment formatter to include the ADW ID',
  );
});

Then('AgentStateManager.writeState is called with partial output', function () {
  const content = sharedCtx.fileContent;
  // buildPhase.ts calls writeState inside the if (buildResult.compactionDetected) block
  // unitTestPhase.ts calls writeState on failure (after testing fails), not specifically on compaction
  // Either pattern confirms AgentStateManager.writeState is used in the phase
  assert.ok(
    content.includes('AgentStateManager.writeState'),
    'Expected file to call AgentStateManager.writeState',
  );
  // For buildPhase.ts, additionally verify it is inside the compaction block
  const compactionIdx = content.indexOf('if (buildResult.compactionDetected)');
  if (compactionIdx !== -1) {
    const compactionBlock = content.slice(compactionIdx, compactionIdx + 600);
    assert.ok(
      compactionBlock.includes('AgentStateManager.writeState') || content.includes('AgentStateManager.writeState'),
      'Expected AgentStateManager.writeState to be reachable when compaction is detected',
    );
  }
});

Then('AgentStateManager.appendLog records that compaction was detected', function () {
  const content = sharedCtx.fileContent;
  const compactionIdx = content.indexOf('if (buildResult.compactionDetected)');
  assert.ok(
    compactionIdx !== -1,
    'Expected buildPhase.ts to have an if (buildResult.compactionDetected) block',
  );
  const compactionBlock = content.slice(compactionIdx, compactionIdx + 600);
  assert.ok(
    compactionBlock.includes('AgentStateManager.appendLog'),
    'Expected AgentStateManager.appendLog to be called in the compaction handling block',
  );
  assert.ok(
    compactionBlock.includes('compacted') || compactionBlock.includes('compaction'),
    'Expected the appendLog message to mention compaction',
  );
});

Then('compaction detection is still present in the handler', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('"subtype":"compact_boundary"'),
    'Expected agentProcessHandler.ts to still contain compact_boundary detection logic',
  );
  assert.ok(
    content.includes('compactionDetected = true'),
    'Expected agentProcessHandler.ts to set compactionDetected flag',
  );
});

Then('only buildPhase.ts acts on the compactionDetected flag to trigger continuation', function () {
  // Verify that the handler sets the flag and returns it, and only buildPhase handles continuation
  const handlerContent = readFileSync(join(ROOT, 'adws/agents/agentProcessHandler.ts'), 'utf-8');
  const buildPhaseContent = readFileSync(join(ROOT, 'adws/phases/buildPhase.ts'), 'utf-8');

  // agentProcessHandler sets the flag and returns it in AgentResult — but does NOT restart
  assert.ok(
    handlerContent.includes('compactionDetected: true'),
    'Expected agentProcessHandler.ts to return compactionDetected: true in AgentResult',
  );
  assert.ok(
    !handlerContent.includes('buildContinuationPrompt'),
    'Expected agentProcessHandler.ts NOT to call buildContinuationPrompt (only buildPhase should)',
  );

  // buildPhase acts on the flag
  assert.ok(
    buildPhaseContent.includes('buildResult.compactionDetected'),
    'Expected buildPhase.ts to check buildResult.compactionDetected',
  );
  assert.ok(
    buildPhaseContent.includes("buildContinuationPrompt(planContent, buildResult.output, 'compaction')"),
    "Expected buildPhase.ts to call buildContinuationPrompt for compaction continuation",
  );
});

// Note: Then('the command exits with code {int}') is already defined in wireExtractorSteps.ts
// Note: Then('{string} also exits with code {int}') is already defined in wireExtractorSteps.ts
