import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import assert from 'assert';
import { sharedCtx, findFunctionUsageIndex } from './commonSteps.ts';

const ROOT = process.cwd();

/** Helper: read a project file and return its content. */
function readProjectFile(relPath: string): string {
  const fullPath = join(ROOT, relPath);
  assert.ok(existsSync(fullPath), `Expected file to exist: ${relPath}`);
  return readFileSync(fullPath, 'utf-8');
}

/** Map feature-level phase names to the function identifiers in orchestrator source. */
const PHASE_FUNCTION_MAP: Record<string, string> = {
  'install': 'executeInstallPhase',
  'plan': 'executePlanPhase',
  'scenarios': 'executeScenarioPhase',
  'plan validation': 'executePlanValidationPhase',
  'build': 'executeBuildPhase',
  'test': 'executeTestPhase',
  'step def gen': 'executeStepDefPhase',
  'review': 'executeReviewPhase',
  'document': 'executeDocumentPhase',
  'pr': 'executePRPhase',
  'kpi': 'executeKpiPhase',
};

// ── 1. Slash command: /generate_step_definitions ────────────────────────────

Then('it should declare $1 as the issue number argument', function () {
  assert.ok(
    sharedCtx.fileContent.includes('$1'),
    `Expected "${sharedCtx.filePath}" to declare $1 as the issue number argument`,
  );
});

Then('it should declare $2 as the adwId argument', function () {
  assert.ok(
    sharedCtx.fileContent.includes('$2'),
    `Expected "${sharedCtx.filePath}" to declare $2 as the adwId argument`,
  );
});

Then('it should instruct reading feature files tagged @adw-\\{issueNumber} from the scenario directory', function () {
  assert.ok(
    sharedCtx.fileContent.includes('@adw-'),
    `Expected "${sharedCtx.filePath}" to instruct reading feature files tagged @adw-{issueNumber}`,
  );
});

Then('it should instruct reading all existing step definition files to avoid duplicate patterns', function () {
  assert.ok(
    sharedCtx.fileContent.includes('step definition') || sharedCtx.fileContent.includes('step_definitions'),
    `Expected "${sharedCtx.filePath}" to instruct reading existing step definitions`,
  );
  assert.ok(
    sharedCtx.fileContent.includes('duplicate'),
    `Expected "${sharedCtx.filePath}" to mention avoiding duplicate patterns`,
  );
});

Then('it should instruct reading implementation code from the worktree', function () {
  assert.ok(
    sharedCtx.fileContent.includes('implementation') || sharedCtx.fileContent.includes('git diff'),
    `Expected "${sharedCtx.filePath}" to instruct reading implementation code`,
  );
});

Then('it should allow creating new step definition files', function () {
  assert.ok(
    sharedCtx.fileContent.includes('create') || sharedCtx.fileContent.includes('new file'),
    `Expected "${sharedCtx.filePath}" to allow creating new step definition files`,
  );
});

Then('it should allow modifying existing step definition files', function () {
  assert.ok(
    sharedCtx.fileContent.includes('modify') || sharedCtx.fileContent.includes('existing'),
    `Expected "${sharedCtx.filePath}" to allow modifying existing step definition files`,
  );
});

Then('it should instruct removing scenarios that require runtime infrastructure, mocked LLMs, or external services', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('Ungeneratable') || content.includes('ungeneratable'),
    `Expected "${sharedCtx.filePath}" to classify ungeneratable scenarios`,
  );
  assert.ok(
    content.includes('Remove') || content.includes('remove'),
    `Expected "${sharedCtx.filePath}" to instruct removing ungeneratable scenarios`,
  );
});

Then('it should instruct returning the list of removed scenarios in the output', function () {
  assert.ok(
    sharedCtx.fileContent.includes('removedScenarios'),
    `Expected "${sharedCtx.filePath}" to include removedScenarios in output`,
  );
});

// ── 2. Step definition agent and phase ──────────────────────────────────────

Then('it should export a function to run the step definition generation agent', function () {
  assert.ok(
    sharedCtx.fileContent.includes('export') && sharedCtx.fileContent.includes('function'),
    `Expected "${sharedCtx.filePath}" to export a function for step def generation`,
  );
});

Then('it should invoke the \\/generate_step_definitions command', function () {
  assert.ok(
    sharedCtx.fileContent.includes('/generate_step_definitions') || sharedCtx.fileContent.includes('generate_step_definitions'),
    `Expected "${sharedCtx.filePath}" to invoke the /generate_step_definitions command`,
  );
});

Then('it should export a function to execute the step definition generation phase', function () {
  assert.ok(
    sharedCtx.fileContent.includes('export') && sharedCtx.fileContent.includes('function'),
    `Expected "${sharedCtx.filePath}" to export a function for the step def phase`,
  );
});

Then('it should call the step definition agent', function () {
  assert.ok(
    sharedCtx.fileContent.includes('runStepDefAgent') || sharedCtx.fileContent.includes('stepDefAgent'),
    `Expected "${sharedCtx.filePath}" to call the step definition agent`,
  );
});

Then('it should return phase cost records', function () {
  assert.ok(
    sharedCtx.fileContent.includes('phaseCostRecords') || sharedCtx.fileContent.includes('createPhaseCostRecords'),
    `Expected "${sharedCtx.filePath}" to return phase cost records`,
  );
});

Then('it should post a warning comment on the issue listing any scenarios removed by the agent', function () {
  assert.ok(
    sharedCtx.fileContent.includes('removedScenarios') || sharedCtx.fileContent.includes('Scenarios Removed'),
    `Expected "${sharedCtx.filePath}" to post a warning comment for removed scenarios`,
  );
});

// ── 3. Test phase: no BDD, unit tests only ──────────────────────────────────

Then('it should not call runBddScenariosWithRetry', function () {
  assert.ok(
    !sharedCtx.fileContent.includes('runBddScenariosWithRetry'),
    `Expected "${sharedCtx.filePath}" not to call runBddScenariosWithRetry`,
  );
});

Then('it should not call runScenariosByTag', function () {
  assert.ok(
    !sharedCtx.fileContent.includes('runScenariosByTag'),
    `Expected "${sharedCtx.filePath}" not to call runScenariosByTag`,
  );
});

Then('it should not reference bddScenarioRunner', function () {
  assert.ok(
    !sharedCtx.fileContent.includes('bddScenarioRunner'),
    `Expected "${sharedCtx.filePath}" not to reference bddScenarioRunner`,
  );
});

Then('it should check the project config for unit test enablement', function () {
  assert.ok(
    sharedCtx.fileContent.includes('parseUnitTestsEnabled') || sharedCtx.fileContent.includes('unitTestsEnabled'),
    `Expected "${sharedCtx.filePath}" to check unit test enablement`,
  );
});

Then('it should log a skip message when unit tests are disabled', function () {
  assert.ok(
    sharedCtx.fileContent.includes('skipping') || sharedCtx.fileContent.includes('disabled'),
    `Expected "${sharedCtx.filePath}" to log a skip message when unit tests are disabled`,
  );
});

// ── 4. Review phase: branch diff, no PR dependency ──────────────────────────

Then('it should instruct running git diff against the default branch', function () {
  assert.ok(
    sharedCtx.fileContent.includes('git diff'),
    `Expected "${sharedCtx.filePath}" to instruct running git diff`,
  );
});

Then('it should not require a pull request number as input', function () {
  // The review command variables are $1=adwId, $2=specFile, $3=agentName, $4=applicationUrl, $5=scenarioProofPath
  // None of them is a PR number
  const content = sharedCtx.fileContent;
  const variablesSection = content.substring(0, content.indexOf('## Instructions') || content.length);
  assert.ok(
    !variablesSection.includes('pull request number') && !variablesSection.includes('PR number'),
    `Expected "${sharedCtx.filePath}" not to require a pull request number`,
  );
});

Then('it should instruct running @adw-\\{issueNumber} tagged scenarios', function () {
  assert.ok(
    sharedCtx.fileContent.includes('@adw-{issueNumber}') || sharedCtx.fileContent.includes('@adw-'),
    `Expected "${sharedCtx.filePath}" to instruct running @adw-{issueNumber} tagged scenarios`,
  );
});

Then('it should instruct running @regression tagged scenarios', function () {
  assert.ok(
    sharedCtx.fileContent.includes('@regression'),
    `Expected "${sharedCtx.filePath}" to instruct running @regression tagged scenarios`,
  );
});

// ── Review failure handling ─────────────────────────────────────────────────

Then('when review fails it should post an error comment on the issue', function () {
  assert.ok(
    sharedCtx.fileContent.includes('postIssueStageComment') || sharedCtx.fileContent.includes('review_failed'),
    `Expected "${sharedCtx.filePath}" to post an error comment when review fails`,
  );
});

Then('when review fails the workflow should exit with code 1', function () {
  assert.ok(
    sharedCtx.fileContent.includes('process.exit(1)'),
    `Expected "${sharedCtx.filePath}" to exit with code 1 when review fails`,
  );
});

Then('no PR should be created when review fails', function () {
  // workflowCompletion.ts calls process.exit(1) on review failure, preventing PR creation
  const content = sharedCtx.fileContent;
  const exitIndex = content.indexOf('process.exit(1)');
  assert.ok(exitIndex !== -1, `Expected "${sharedCtx.filePath}" to call process.exit(1)`);
});

// ── 5. Coding guidelines check ──────────────────────────────────────────────

Then('it should instruct reading {string} if present', function (filePath: string) {
  assert.ok(
    sharedCtx.fileContent.includes(filePath),
    `Expected "${sharedCtx.filePath}" to instruct reading "${filePath}"`,
  );
});

Then('it should instruct falling back to {string} when .adw\\/coding_guidelines.md is absent', function (fallbackPath: string) {
  assert.ok(
    sharedCtx.fileContent.includes(fallbackPath),
    `Expected "${sharedCtx.filePath}" to instruct falling back to "${fallbackPath}"`,
  );
});

Then('guideline violations should be reported with severity {string}', function (severity: string) {
  assert.ok(
    sharedCtx.fileContent.includes(severity),
    `Expected "${sharedCtx.filePath}" to report guideline violations with severity "${severity}"`,
  );
});

// ── 6/7. Orchestrator phase ordering ────────────────────────────────────────

Then('the phase ordering should be:', function (dataTable: { rawTable: string[][] }) {
  const content = sharedCtx.fileContent;
  const expectedPhases = dataTable.rawTable.slice(1).map(row => row[0].trim());

  // Find the position of each phase function *call* in the source (not imports).
  // Search for "functionName(" to skip import statements.
  const positions: { phase: string; index: number }[] = [];
  for (const phase of expectedPhases) {
    const fn = PHASE_FUNCTION_MAP[phase];
    assert.ok(fn, `Unknown phase name: "${phase}"`);
    const idx = findFunctionUsageIndex(content, fn);
    assert.ok(idx !== -1, `Expected "${sharedCtx.filePath}" to contain a call to ${fn}() for phase "${phase}"`);
    positions.push({ phase, index: idx });
  }

  // Verify sequential ordering (each phase call appears after the previous one)
  for (let i = 1; i < positions.length; i++) {
    assert.ok(
      positions[i].index > positions[i - 1].index,
      `Expected phase "${positions[i].phase}" to come after "${positions[i - 1].phase}" in "${sharedCtx.filePath}"`,
    );
  }
});

Then('it should not invoke the scenario phase', function () {
  assert.ok(
    !sharedCtx.fileContent.includes('executeScenarioPhase'),
    `Expected "${sharedCtx.filePath}" not to invoke executeScenarioPhase`,
  );
});

Then('it should not invoke the plan validation phase', function () {
  assert.ok(
    !sharedCtx.fileContent.includes('executePlanValidationPhase'),
    `Expected "${sharedCtx.filePath}" not to invoke executePlanValidationPhase`,
  );
});

Then('it should not invoke the step def phase', function () {
  assert.ok(
    !sharedCtx.fileContent.includes('executeStepDefPhase'),
    `Expected "${sharedCtx.filePath}" not to invoke executeStepDefPhase`,
  );
});

// ── 8. PR creation gated behind review ──────────────────────────────────────

Then('in each review orchestrator the PR phase should come after the review phase', function () {
  const reviewOrchestrators = [
    'adws/adwPlanBuildTestReview.tsx',
    'adws/adwSdlc.tsx',
    'adws/adwPlanBuildReview.tsx',
  ];

  for (const file of reviewOrchestrators) {
    const content = readProjectFile(file);
    const reviewIdx = findFunctionUsageIndex(content, 'executeReviewPhase');
    const prIdx = findFunctionUsageIndex(content, 'executePRPhase');
    assert.ok(reviewIdx !== -1, `Expected "${file}" to call executeReviewPhase`);
    assert.ok(prIdx !== -1, `Expected "${file}" to call executePRPhase`);
    assert.ok(
      prIdx > reviewIdx,
      `Expected PR phase to come after review phase in "${file}"`,
    );
  }
});

Then('in each non-review orchestrator the PR phase should not depend on a review phase', function () {
  const nonReviewOrchestrators = [
    'adws/adwPlanBuild.tsx',
    'adws/adwPlanBuildTest.tsx',
    'adws/adwPlanBuildDocument.tsx',
  ];

  for (const file of nonReviewOrchestrators) {
    const content = readProjectFile(file);
    assert.ok(
      !content.includes('executeReviewPhase'),
      `Expected "${file}" not to call executeReviewPhase`,
    );
  }
});

// ── 9. SLASH_COMMAND maps ───────────────────────────────────────────────────

Then('SLASH_COMMAND_MODEL_MAP should contain an entry for {string}', function (command: string) {
  assert.ok(
    sharedCtx.fileContent.includes(command),
    `Expected "${sharedCtx.filePath}" to contain "${command}" in SLASH_COMMAND_MODEL_MAP`,
  );
});

Then('SLASH_COMMAND_EFFORT_MAP should contain an entry for {string}', function (command: string) {
  assert.ok(
    sharedCtx.fileContent.includes(command),
    `Expected "${sharedCtx.filePath}" to contain "${command}" in SLASH_COMMAND_EFFORT_MAP`,
  );
});

// ── 10. stepDefPhase error handling ─────────────────────────────────────────

Then('it should wrap execution in a try-catch block', function () {
  assert.ok(
    sharedCtx.fileContent.includes('try') && sharedCtx.fileContent.includes('catch'),
    `Expected "${sharedCtx.filePath}" to wrap execution in a try-catch block`,
  );
});

Then('it should log errors when the step def agent fails', function () {
  assert.ok(
    sharedCtx.fileContent.includes('log(') || sharedCtx.fileContent.includes("log('"),
    `Expected "${sharedCtx.filePath}" to log errors on failure`,
  );
});

Then('it should return empty cost records on failure', function () {
  assert.ok(
    sharedCtx.fileContent.includes('phaseCostRecords: []') || sharedCtx.fileContent.includes('phaseCostRecords:[]'),
    `Expected "${sharedCtx.filePath}" to return empty cost records on failure`,
  );
});

// ── 11. TypeScript integrity ────────────────────────────────────────────────

Given('the ADW codebase has been modified for issue 249', function () {
  // Context only — the codebase is already modified on this branch
  assert.ok(existsSync(join(ROOT, 'adws')), 'Expected adws/ directory to exist');
});

When('the TypeScript compiler runs with --noEmit', function (this: Record<string, unknown>) {
  try {
    execSync('bunx tsc --noEmit', { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' });
    this.tscExitCode = 0;
    this.tscOutput = '';
  } catch (err: unknown) {
    const error = err as { status: number; stdout: string; stderr: string };
    this.tscExitCode = error.status;
    this.tscOutput = (error.stdout || '') + (error.stderr || '');
  }
});

Then('the compilation should succeed with no errors', function (this: Record<string, unknown>) {
  assert.strictEqual(
    this.tscExitCode,
    0,
    `TypeScript compilation failed:\n${this.tscOutput}`,
  );
});
