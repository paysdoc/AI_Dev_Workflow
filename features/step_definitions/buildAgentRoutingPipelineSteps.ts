import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

/** Shared multi-file context for scenarios that inspect multiple orchestrator files at once. */
const multiFileCtx: { files: Record<string, string> } = { files: {} };

// ── 1. Build agent routing — scenario detection ──────────────────────────────
// Background: 'Given the ADW codebase is checked out' is in commonSteps.ts
// 'Given the file {string} is read' is in commonSteps.ts

Then('it imports or calls findScenarioFiles to detect .feature files tagged @adw-\\{issueNumber}', function () {
  assert.ok(
    sharedCtx.fileContent.includes('findScenarioFiles'),
    `Expected "${sharedCtx.filePath}" to import or call findScenarioFiles`,
  );
});

Then('the detection uses the issue number passed to runBuildAgent', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('issue.number') || content.includes('issueNumber'),
    `Expected "${sharedCtx.filePath}" to use the issue number in scenario detection`,
  );
});

Given('.feature files tagged @adw-\\{issueNumber} exist in the worktree', function () {
  // Context: .feature files with @adw-{issueNumber} tags exist in this repository
  assert.ok(existsSync(join(ROOT, 'features')), 'Expected features/ directory to exist');
});

Given('no .feature files tagged @adw-\\{issueNumber} exist in the worktree', function () {
  // Context annotation for the fallback /implement path — no assertion needed
});

When('runBuildAgent is called', function () {
  // Context-only — the assertion is done in Then steps via source code inspection
});

When('runBuildAgent is called with or without scenarios present', function () {
  // Context-only — verified by source code inspection in Then steps
});

When('runBuildAgent selects \\/implement-tdd', function () {
  // Context-only — verified by source code inspection in Then steps
});

When('runBuildAgent selects \\/implement', function () {
  // Context-only — verified by source code inspection in Then steps
});

Then('the agent config uses {string} as the command', function (command: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`'${command}'`) || content.includes(`"${command}"`),
    `Expected "${sharedCtx.filePath}" to use command "${command}"`,
  );
});

Then('it logs whether TDD mode or standard mode was selected', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('TDD') && (content.includes('standard') || content.includes('implement')),
    `Expected "${sharedCtx.filePath}" to log TDD mode vs standard mode selection`,
  );
});

// ── 2. Build agent routing — scenario file paths ─────────────────────────────

Then('the agent arguments include the scenario file paths', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('scenarioFiles'),
    `Expected "${sharedCtx.filePath}" to include scenarioFiles in the agent arguments`,
  );
});

Then('the scenario file paths are passed alongside the plan content', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('scenarioFiles') && content.includes('planContent'),
    `Expected "${sharedCtx.filePath}" to pass scenario file paths alongside plan content`,
  );
});

Then('the agent arguments do not include scenario file paths', function () {
  const content = sharedCtx.fileContent;
  // Standard mode uses baseArgs only — the conditional (useTdd ? ... : baseArgs)
  // ensures no scenario paths are appended when no scenarios exist
  assert.ok(
    content.includes('baseArgs'),
    `Expected "${sharedCtx.filePath}" to use baseArgs (without scenario file paths) in standard mode`,
  );
  assert.ok(
    content.includes('useTdd'),
    `Expected "${sharedCtx.filePath}" to have useTdd conditional to exclude scenario paths`,
  );
});

// ── 3. Build phase passes context to build agent ─────────────────────────────

Then('runBuildAgent is called with the worktree path', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('worktreePath') && content.includes('runBuildAgent'),
    `Expected "${sharedCtx.filePath}" to call runBuildAgent with worktreePath`,
  );
});

Then('runBuildAgent is called with the issue number or issue object', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('issue') && content.includes('runBuildAgent'),
    `Expected "${sharedCtx.filePath}" to call runBuildAgent with the issue object`,
  );
});

Then('the build agent can use both to detect and read scenario files', function () {
  const content = sharedCtx.fileContent;
  // buildPhase.ts passes issue (with issue.number) and worktreePath to runBuildAgent,
  // which internally calls findScenarioFiles(issue.number, worktreePath)
  assert.ok(
    content.includes('issue') && content.includes('worktreePath'),
    `Expected "${sharedCtx.filePath}" to pass both issue and worktreePath to the build agent`,
  );
});

// ── 4. SlashCommand type ──────────────────────────────────────────────────────
// Note: 'Then the SlashCommand union type includes {string}' is already in singlePassAlignmentPhaseSteps.ts

// ── 5. /implement-tdd in model routing tables ────────────────────────────────
// Note: 'Then SLASH_COMMAND_MODEL_MAP includes an entry for {string}' is in singlePassAlignmentPhaseSteps.ts
// Note: 'Then SLASH_COMMAND_EFFORT_MAP includes an entry for {string}' is in singlePassAlignmentPhaseSteps.ts

Then('SLASH_COMMAND_MODEL_MAP maps {string} to the same model as {string}', function (cmdA: string, cmdB: string) {
  const content = sharedCtx.fileContent;
  const modelA = getCommandMapping(content, cmdA);
  const modelB = getCommandMapping(content, cmdB);
  assert.ok(modelA !== undefined, `Expected "${cmdA}" to have a model mapping in "${sharedCtx.filePath}"`);
  assert.ok(modelB !== undefined, `Expected "${cmdB}" to have a model mapping in "${sharedCtx.filePath}"`);
  assert.strictEqual(
    modelA,
    modelB,
    `Expected "${cmdA}" and "${cmdB}" to map to the same model tier, got "${modelA}" vs "${modelB}"`,
  );
});

Then('SLASH_COMMAND_EFFORT_MAP maps {string} to the same effort as {string}', function (cmdA: string, cmdB: string) {
  const content = sharedCtx.fileContent;
  const effortA = getCommandMapping(content, cmdA);
  const effortB = getCommandMapping(content, cmdB);
  assert.ok(effortA !== undefined, `Expected "${cmdA}" to have an effort mapping in "${sharedCtx.filePath}"`);
  assert.ok(effortB !== undefined, `Expected "${cmdB}" to have an effort mapping in "${sharedCtx.filePath}"`);
  assert.strictEqual(
    effortA,
    effortB,
    `Expected "${cmdA}" and "${cmdB}" to map to the same effort level, got "${effortA}" vs "${effortB}"`,
  );
});

/** Extracts the mapped value for a slash command key from source containing a Record literal. */
function getCommandMapping(content: string, command: string): string | undefined {
  // Matches lines like: '/implement-tdd': 'sonnet',  or  '/implement': 'high',
  const escapedCmd = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`'${escapedCmd}'\\s*:\\s*'([^']+)'`));
  return match ? match[1] : undefined;
}

// ── 6–8. Orchestrator pipeline restructure ───────────────────────────────────
// Note: 'Then the phase ordering should be:' is in stepDefGenReviewGatingSteps.ts

Then('executeStepDefPhase is not called', function () {
  assert.ok(
    !sharedCtx.fileContent.includes('executeStepDefPhase'),
    `Expected "${sharedCtx.filePath}" not to call executeStepDefPhase`,
  );
});

Then('executePlanValidationPhase is not called', function () {
  assert.ok(
    !sharedCtx.fileContent.includes('executePlanValidationPhase'),
    `Expected "${sharedCtx.filePath}" not to call executePlanValidationPhase`,
  );
});

Then('executePlanPhase and executeScenarioPhase run in parallel \\(Promise.all or equivalent\\)', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('runPhasesParallel') &&
    content.includes('executePlanPhase') &&
    content.includes('executeScenarioPhase'),
    `Expected "${sharedCtx.filePath}" to run executePlanPhase and executeScenarioPhase in parallel via runPhasesParallel`,
  );
});

Then('executeAlignmentPhase runs after the parallel phase completes', function () {
  const content = sharedCtx.fileContent;
  const parallelIdx = content.indexOf('runPhasesParallel');
  const alignmentIdx = content.indexOf('executeAlignmentPhase');
  assert.ok(parallelIdx !== -1, `Expected "${sharedCtx.filePath}" to call runPhasesParallel`);
  assert.ok(alignmentIdx !== -1, `Expected "${sharedCtx.filePath}" to call executeAlignmentPhase`);
  assert.ok(
    alignmentIdx > parallelIdx,
    `Expected executeAlignmentPhase to come after runPhasesParallel in "${sharedCtx.filePath}"`,
  );
});

// ── 9. Non-scenario orchestrators remain unchanged ────────────────────────────

Then('it should not invoke executeScenarioPhase', function () {
  assert.ok(
    !sharedCtx.fileContent.includes('executeScenarioPhase'),
    `Expected "${sharedCtx.filePath}" not to invoke executeScenarioPhase`,
  );
});

Then('it should not invoke executeAlignmentPhase', function () {
  assert.ok(
    !sharedCtx.fileContent.includes('executeAlignmentPhase'),
    `Expected "${sharedCtx.filePath}" not to invoke executeAlignmentPhase`,
  );
});

Then('it should not invoke executeStepDefPhase', function () {
  assert.ok(
    !sharedCtx.fileContent.includes('executeStepDefPhase'),
    `Expected "${sharedCtx.filePath}" not to invoke executeStepDefPhase`,
  );
});

// ── 10/11. Multi-orchestrator checks ─────────────────────────────────────────

Given('the files {string}, {string}, and {string} are read', function (file1: string, file2: string, file3: string) {
  multiFileCtx.files = {};
  for (const filePath of [file1, file2, file3]) {
    const fullPath = join(ROOT, filePath);
    assert.ok(existsSync(fullPath), `Expected file to exist: ${filePath}`);
    multiFileCtx.files[filePath] = readFileSync(fullPath, 'utf-8');
  }
});

Then('none of them import {word}', function (funcName: string) {
  for (const [filePath, content] of Object.entries(multiFileCtx.files)) {
    assert.ok(
      !content.includes(funcName),
      `Expected "${filePath}" not to import or reference ${funcName}`,
    );
  }
});

Then('none of them call {word}', function (funcName: string) {
  for (const [filePath, content] of Object.entries(multiFileCtx.files)) {
    assert.ok(
      !content.includes(funcName),
      `Expected "${filePath}" not to call ${funcName}`,
    );
  }
});

// ── 14. Build agent TDD config reuses existing agent identifier ───────────────

Then('buildAgentTddConfig uses the same agent name as the standard buildAgentConfig', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('buildAgentTddConfig') && content.includes('buildAgentConfig'),
    `Expected "${sharedCtx.filePath}" to define both buildAgentTddConfig and buildAgentConfig`,
  );
  // Both configs (excluding prReviewBuildAgentConfig) should use the same agentName
  const nameMatches = Array.from(content.matchAll(/agentName:\s*'([^']+)'/g));
  const agentNames = nameMatches.map(m => m[1]).filter(n => n !== 'PR Review Build');
  const uniqueNames = Array.from(new Set(agentNames));
  assert.strictEqual(
    uniqueNames.length,
    1,
    `Expected buildAgentConfig and buildAgentTddConfig to use the same agentName, found: ${agentNames.join(', ')}`,
  );
});

Then('no new AgentIdentifier value is required for TDD mode', function () {
  const content = sharedCtx.fileContent;
  // TDD config reuses the existing 'Build' agentName — no new enum value introduced
  assert.ok(
    !content.includes("agentName: 'BuildTdd'") &&
    !content.includes("agentName: 'Build Tdd'") &&
    !content.includes("agentName: 'TDD Build'"),
    `Expected buildAgentTddConfig not to introduce a new AgentIdentifier value for TDD mode`,
  );
});

// ── 15. TypeScript type-check passes ─────────────────────────────────────────
// Note: 'When {string} is run' is defined in removeUnitTestsSteps.ts
// Note: 'Then the command exits with code {int}' is defined in wireExtractorSteps.ts
// Note: 'Then {string} also exits with code {int}' is defined in wireExtractorSteps.ts

Given('the ADW codebase with build agent routing implemented', function () {
  assert.ok(
    existsSync(join(ROOT, 'adws/agents/buildAgent.ts')),
    'Expected adws/agents/buildAgent.ts to exist',
  );
  assert.ok(
    existsSync(join(ROOT, 'adws/core/modelRouting.ts')),
    'Expected adws/core/modelRouting.ts to exist',
  );
});
