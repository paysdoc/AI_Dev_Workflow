import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx, findFunctionUsageIndex } from './commonSteps.ts';

const ROOT = process.cwd();

// Scenario-local state for alignment phase steps
const local: { alignmentPhaseContent: string } = {
  alignmentPhaseContent: '',
};

function readAlignmentPhase(): string {
  if (!local.alignmentPhaseContent) {
    const filePath = join(ROOT, 'adws/phases/alignmentPhase.ts');
    assert.ok(existsSync(filePath), 'Expected adws/phases/alignmentPhase.ts to exist');
    local.alignmentPhaseContent = readFileSync(filePath, 'utf-8');
  }
  return local.alignmentPhaseContent;
}

// ── File existence ────────────────────────────────────────────────────────────
// Note: 'Given the file {string} exists' is defined in cucumberConfigSteps.ts

Then('the file contains {string} in its frontmatter', function (expected: string) {
  const content = sharedCtx.fileContent;
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';
  assert.ok(
    frontmatter.includes(expected),
    `Expected frontmatter of "${sharedCtx.filePath}" to contain "${expected}". Frontmatter: ${frontmatter}`,
  );
});

Then('the file defines arguments for adwId, issueNumber, planFilePath, scenarioGlob, and issueJson', function () {
  const content = sharedCtx.fileContent;
  for (const arg of ['adwId', 'issueNumber', 'planFilePath', 'scenarioGlob', 'issueJson']) {
    assert.ok(content.includes(arg), `Expected "${sharedCtx.filePath}" to define argument "${arg}"`);
  }
});

// ── Module exports ────────────────────────────────────────────────────────────

Then('the module exports {string} from {string}', function (exportName: string, modulePath: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(exportName),
    `Expected "${sharedCtx.filePath}" to export "${exportName}"`,
  );
  assert.ok(
    content.includes(modulePath),
    `Expected "${sharedCtx.filePath}" to reference module "${modulePath}"`,
  );
});

Then('{string} is re-exported from the module', function (exportName: string) {
  assert.ok(
    sharedCtx.fileContent.includes(exportName),
    `Expected "${sharedCtx.filePath}" to re-export "${exportName}"`,
  );
});

// ── Alignment phase: plan file and scenario discovery ─────────────────────────

Given('the alignment phase is configured with a valid plan file', function () {
  local.alignmentPhaseContent = readAlignmentPhase();
  sharedCtx.fileContent = local.alignmentPhaseContent;
  sharedCtx.filePath = 'adws/phases/alignmentPhase.ts';
});

Given('the alignment phase is configured with scenario files tagged @adw-\\{issueNumber\\}', function () {
  local.alignmentPhaseContent = readAlignmentPhase();
  sharedCtx.fileContent = local.alignmentPhaseContent;
  sharedCtx.filePath = 'adws/phases/alignmentPhase.ts';
});

When('executeAlignmentPhase is called', function () {
  // Context only — assertions happen in Then steps (code inspection)
});

Then('the phase reads the plan file content via readPlanFile before invoking the agent', function () {
  assert.ok(
    local.alignmentPhaseContent.includes('readPlanFile'),
    'Expected alignmentPhase.ts to call readPlanFile before invoking the agent',
  );
});

Then('the phase calls findScenarioFiles with the issue number and worktree path', function () {
  assert.ok(
    local.alignmentPhaseContent.includes('findScenarioFiles'),
    'Expected alignmentPhase.ts to call findScenarioFiles',
  );
});

Then('only scenario files containing the @adw-\\{issueNumber\\} tag are included', function () {
  // findScenarioFiles in validationAgent.ts already filters by @adw-{issueNumber}
  const filePath = join(ROOT, 'adws/agents/validationAgent.ts');
  const content = readFileSync(filePath, 'utf-8');
  assert.ok(
    content.includes('@adw-'),
    'Expected validationAgent.ts findScenarioFiles to filter by @adw-{issueNumber} tag',
  );
});

// ── Unresolvable conflicts: warnings, not errors ──────────────────────────────

Given('the alignment agent encounters a conflict it cannot resolve from the issue', function () {
  local.alignmentPhaseContent = readAlignmentPhase();
  const agentPath = join(ROOT, 'adws/agents/alignmentAgent.ts');
  sharedCtx.fileContent = readFileSync(agentPath, 'utf-8') + '\n' + local.alignmentPhaseContent;
  sharedCtx.filePath = 'alignmentAgent.ts + alignmentPhase.ts';
});

When('the alignment agent produces its result', function () {
  // Context only
});

Then('the {string} array contains a description of the unresolvable conflict', function (fieldName: string) {
  assert.ok(
    sharedCtx.fileContent.includes(fieldName),
    `Expected alignment code to handle "${fieldName}" array`,
  );
});

Then('the {string} field is false', function (fieldName: string) {
  assert.ok(
    sharedCtx.fileContent.includes(fieldName),
    `Expected alignment code to handle "${fieldName}" field`,
  );
});

Then('the workflow does not throw an error', function () {
  const content = local.alignmentPhaseContent;
  // Verify the phase logs warnings but does not throw (no throw statements)
  assert.ok(
    content.includes('"warn"'),
    'Expected alignmentPhase.ts to log at warn level',
  );
  assert.ok(
    !content.match(/^\s*throw\s/m),
    'Expected alignmentPhase.ts not to contain throw statements',
  );
});

// ── Warnings logged but workflow not halted ───────────────────────────────────

Given('the alignment agent returns warnings for unresolvable conflicts', function () {
  local.alignmentPhaseContent = readAlignmentPhase();
  sharedCtx.fileContent = local.alignmentPhaseContent;
  sharedCtx.filePath = 'adws/phases/alignmentPhase.ts';
});

When('executeAlignmentPhase processes the alignment result', function () {
  // Context only
});

Then('each warning is logged at {string} level', function (level: string) {
  assert.ok(
    local.alignmentPhaseContent.includes(`"${level}"`),
    `Expected alignmentPhase.ts to log at "${level}" level`,
  );
});

Then('the phase returns successfully without throwing', function () {
  const content = local.alignmentPhaseContent;
  assert.ok(
    content.includes('phaseCostRecords'),
    'Expected alignmentPhase.ts to return phaseCostRecords',
  );
  assert.ok(
    !content.match(/^\s*throw\s/m),
    'Expected alignmentPhase.ts not to contain throw statements',
  );
});

// ── No retry loop ─────────────────────────────────────────────────────────────

Then('the file does not contain {string} or {string}', function (str1: string, str2: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    !content.includes(str1),
    `Expected "${sharedCtx.filePath}" not to contain "${str1}"`,
  );
  assert.ok(
    !content.includes(str2),
    `Expected "${sharedCtx.filePath}" not to contain "${str2}"`,
  );
});

Then('the file does not contain a while loop or for loop around the agent invocation', function () {
  const content = sharedCtx.fileContent;
  const agentCallIdx = content.indexOf('runAlignmentAgent');
  assert.ok(agentCallIdx !== -1, `Expected "${sharedCtx.filePath}" to call runAlignmentAgent`);
  // Check a window before the agent call for loop constructs
  const windowBefore = content.substring(Math.max(0, agentCallIdx - 500), agentCallIdx);
  assert.ok(
    !windowBefore.includes('for (') && !windowBefore.includes('for(') &&
    !windowBefore.includes('while (') && !windowBefore.includes('while('),
    'Expected runAlignmentAgent not to be called inside a for/while loop',
  );
});

Then('runAlignmentAgent is called at most once per phase execution', function () {
  const content = sharedCtx.fileContent;
  const awaitCalls = (content.match(/await runAlignmentAgent/g) || []).length;
  assert.ok(
    awaitCalls <= 1,
    `Expected runAlignmentAgent to be called at most once, found ${awaitCalls} await call(s)`,
  );
});

// ── PhaseCostRecord entries ───────────────────────────────────────────────────

Given('the alignment phase completes successfully', function () {
  local.alignmentPhaseContent = readAlignmentPhase();
  sharedCtx.fileContent = local.alignmentPhaseContent;
  sharedCtx.filePath = 'adws/phases/alignmentPhase.ts';
});

When('the phase result is returned', function () {
  // Context only
});

Then('the result includes a {string} array', function (fieldName: string) {
  assert.ok(
    sharedCtx.fileContent.includes(fieldName),
    `Expected alignmentPhase.ts to include "${fieldName}" in its return`,
  );
});

Then('each record has phase set to {string}', function (phaseName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`'${phaseName}'`) || content.includes(`"${phaseName}"`),
    `Expected alignmentPhase.ts to create records with phase "${phaseName}"`,
  );
});

Then('each record has a valid workflowId, issueNumber, status, and durationMs', function () {
  const content = sharedCtx.fileContent;
  for (const field of ['workflowId', 'issueNumber', 'status', 'durationMs']) {
    assert.ok(content.includes(field), `Expected alignmentPhase.ts to include "${field}" in phase cost records`);
  }
});

// ── Orchestrator integration ──────────────────────────────────────────────────

Then('executePlanPhase and executeScenarioPhase run in parallel', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('runPhasesParallel') &&
    content.includes('executePlanPhase') &&
    content.includes('executeScenarioPhase'),
    `Expected "${sharedCtx.filePath}" to run executePlanPhase and executeScenarioPhase in parallel`,
  );
});

Then('executeAlignmentPhase runs immediately after the parallel phase completes', function () {
  const content = sharedCtx.fileContent;
  const parallelIdx = content.indexOf('runPhasesParallel');
  const alignmentIdx = findFunctionUsageIndex(content, 'executeAlignmentPhase');
  assert.ok(parallelIdx !== -1, `Expected "${sharedCtx.filePath}" to call runPhasesParallel`);
  assert.ok(alignmentIdx !== -1, `Expected "${sharedCtx.filePath}" to call executeAlignmentPhase`);
  assert.ok(
    alignmentIdx > parallelIdx,
    `Expected executeAlignmentPhase to come after runPhasesParallel in "${sharedCtx.filePath}"`,
  );
});

Then('executeAlignmentPhase runs before executeBuildPhase', function () {
  const content = sharedCtx.fileContent;
  const alignmentIdx = findFunctionUsageIndex(content, 'executeAlignmentPhase');
  const buildIdx = findFunctionUsageIndex(content, 'executeBuildPhase');
  assert.ok(alignmentIdx !== -1, `Expected "${sharedCtx.filePath}" to call executeAlignmentPhase`);
  assert.ok(buildIdx !== -1, `Expected "${sharedCtx.filePath}" to call executeBuildPhase`);
  assert.ok(
    buildIdx > alignmentIdx,
    `Expected executeBuildPhase to come after executeAlignmentPhase in "${sharedCtx.filePath}"`,
  );
});

// ── Type union checks ─────────────────────────────────────────────────────────

Then('the AgentIdentifier union type includes {string}', function (value: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`'${value}'`) || content.includes(`"${value}"`),
    `Expected "${sharedCtx.filePath}" AgentIdentifier to include "${value}"`,
  );
});

Then('SLASH_COMMAND_MODEL_MAP includes an entry for {string}', function (command: string) {
  assert.ok(
    sharedCtx.fileContent.includes(command),
    `Expected "${sharedCtx.filePath}" SLASH_COMMAND_MODEL_MAP to include "${command}"`,
  );
});

Then('SLASH_COMMAND_EFFORT_MAP includes an entry for {string}', function (command: string) {
  assert.ok(
    sharedCtx.fileContent.includes(command),
    `Expected "${sharedCtx.filePath}" SLASH_COMMAND_EFFORT_MAP to include "${command}"`,
  );
});

Then('the SlashCommand union type includes {string}', function (value: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`'${value}'`) || content.includes(`"${value}"`),
    `Expected "${sharedCtx.filePath}" SlashCommand to include "${value}"`,
  );
});

// ── Recovery state ────────────────────────────────────────────────────────────

Given('the recovery state indicates {string} has already been completed', function (stage: string) {
  local.alignmentPhaseContent = readAlignmentPhase();
  sharedCtx.fileContent = local.alignmentPhaseContent;
  sharedCtx.filePath = 'adws/phases/alignmentPhase.ts';
  assert.ok(
    local.alignmentPhaseContent.includes(stage),
    `Expected alignmentPhase.ts to reference stage "${stage}"`,
  );
});

Then('the phase is skipped', function () {
  const content = local.alignmentPhaseContent;
  assert.ok(
    content.includes('shouldExecuteStage') && content.includes('plan_aligning'),
    'Expected alignmentPhase.ts to check shouldExecuteStage for plan_aligning',
  );
});

Then('the phase returns costUsd = 0 and empty phaseCostRecords', function () {
  const content = local.alignmentPhaseContent;
  assert.ok(
    content.includes('phaseCostRecords: []') || content.includes('costUsd: 0'),
    'Expected alignmentPhase.ts to return costUsd=0 and empty phaseCostRecords on skip',
  );
});

// ── parseAlignmentResult: graceful non-JSON handling ─────────────────────────

Given('the alignment agent returns non-JSON text output', function () {
  const filePath = join(ROOT, 'adws/agents/alignmentAgent.ts');
  assert.ok(existsSync(filePath), 'Expected adws/agents/alignmentAgent.ts to exist');
  sharedCtx.fileContent = readFileSync(filePath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/alignmentAgent.ts';
});

When('parseAlignmentResult is called', function () {
  // Context only — assertions verify the fallback logic via code inspection
});

Then('the result has aligned = true', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('aligned: true'),
    'Expected parseAlignmentResult to return aligned: true on non-JSON input',
  );
});

Then('the result has a single warning describing the parse failure', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('warnings:'),
    'Expected parseAlignmentResult fallback to include a warnings array',
  );
});

Then('the result has empty changes array', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('changes: []'),
    'Expected parseAlignmentResult fallback to return an empty changes array',
  );
});

// ── TypeScript type-check ─────────────────────────────────────────────────────
// Note: 'When {string} is run', 'Then the command exits with code {int}',
// and 'Then {string} also exits with code {int}' are defined in existing step files.

Given('the ADW codebase with alignment phase implemented', function () {
  assert.ok(
    existsSync(join(ROOT, 'adws/phases/alignmentPhase.ts')),
    'Expected adws/phases/alignmentPhase.ts to exist',
  );
});
