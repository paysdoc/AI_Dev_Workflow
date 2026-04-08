import { Then } from '@cucumber/cucumber';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── Scenario: Review phase runs scenario proof before review agents ───────────

Then('the scenario proof invocation occurs before the review agent launch', function () {
  const content = sharedCtx.fileContent;
  const proofIdx = content.indexOf('runScenarioProof(');
  const agentIdx = content.indexOf('runReviewAgent(');
  assert.ok(proofIdx !== -1, `Expected "${sharedCtx.filePath}" to call runScenarioProof`);
  assert.ok(agentIdx !== -1, `Expected "${sharedCtx.filePath}" to call runReviewAgent`);
  assert.ok(
    proofIdx < agentIdx,
    `Expected runScenarioProof to be invoked before runReviewAgent in "${sharedCtx.filePath}"`,
  );
});

// ── Scenario: runScenariosByTag captures both stdout and stderr ───────────────

Then('the resolved result includes stdout, stderr, and exitCode fields', function () {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes('stdout'), `Expected "${sharedCtx.filePath}" result to include stdout field`);
  assert.ok(content.includes('stderr'), `Expected "${sharedCtx.filePath}" result to include stderr field`);
  assert.ok(content.includes('exitCode'), `Expected "${sharedCtx.filePath}" result to include exitCode field`);
});

// ── Scenario: runScenariosByTag skips gracefully when tagCommand is N/A or empty

Then('the file checks for empty or N\\/A tagCommand before spawning a subprocess', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes("'N/A'") || content.includes('"N/A"'),
    `Expected "${sharedCtx.filePath}" to check for N/A tagCommand`,
  );
  assert.ok(
    content.includes('!tagCommand') || content.includes('tagCommand.trim()'),
    `Expected "${sharedCtx.filePath}" to check for empty tagCommand`,
  );
});

Then('it returns allPassed true when the command is skipped', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('allPassed: true'),
    `Expected "${sharedCtx.filePath}" to return allPassed: true when command is skipped`,
  );
});

// ── Scenario: Scenario proof detects blocker failures from non-passing tags ───

Then('hasBlockerFailures is true when any non-skipped tag with severity blocker did not pass', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes("severity === 'blocker'") || content.includes('severity === "blocker"'),
    `Expected "${sharedCtx.filePath}" hasBlockerFailures to filter by blocker severity`,
  );
  assert.ok(
    content.includes('!r.passed') || content.includes('!result.passed'),
    `Expected "${sharedCtx.filePath}" hasBlockerFailures to require tag did not pass`,
  );
  assert.ok(
    content.includes('!r.skipped') || content.includes('!result.skipped'),
    `Expected "${sharedCtx.filePath}" hasBlockerFailures to exclude skipped tags`,
  );
});

// ── Scenario: Scenario proof skips optional tags with zero matching scenarios ──

Then('when a tag is optional and produces zero scenarios output it is marked as skipped', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('optional') && content.includes('skipped: true'),
    `Expected "${sharedCtx.filePath}" to mark optional zero-scenario tags as skipped`,
  );
});

Then('skipped tags do not count as blocker failures', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('!r.skipped') || content.includes('!result.skipped'),
    `Expected "${sharedCtx.filePath}" to exclude skipped tags from blocker failure check`,
  );
});

// ── Scenario: Step def gen phase precedes review phase in all orchestrators ───

Then('in each review orchestrator the step def gen phase precedes the review phase', function () {
  const orchestrators = [
    'adws/adwPlanBuildTestReview.tsx',
    'adws/adwSdlc.tsx',
    'adws/adwPlanBuildReview.tsx',
  ];
  for (const relPath of orchestrators) {
    const fullPath = join(ROOT, relPath);
    assert.ok(existsSync(fullPath), `Expected orchestrator to exist: ${relPath}`);
    const content = readFileSync(fullPath, 'utf-8');
    const stepDefIdx = content.indexOf('executeStepDefPhase');
    const reviewIdx = content.indexOf('executeReviewPhase');
    assert.ok(stepDefIdx !== -1, `Expected ${relPath} to call executeStepDefPhase`);
    assert.ok(reviewIdx !== -1, `Expected ${relPath} to call executeReviewPhase`);
    assert.ok(
      stepDefIdx < reviewIdx,
      `Expected executeStepDefPhase to precede executeReviewPhase in ${relPath}`,
    );
  }
});

// ── Scenario: Scenario proof writes detailed markdown with output per tag ──────

Then('the proof markdown includes the resolved tag name', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('resolvedTag'),
    `Expected "${sharedCtx.filePath}" proof markdown to include resolvedTag`,
  );
});

Then('the proof markdown includes the exit code', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('exitCode'),
    `Expected "${sharedCtx.filePath}" proof markdown to include exitCode`,
  );
});

Then('the proof markdown includes the scenario output', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('result.output'),
    `Expected "${sharedCtx.filePath}" proof markdown to include scenario output`,
  );
});

// ── Scenario: Review failure error message includes blocker count ──────────────

Then('the review failure message includes the number of remaining blockers', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('blockerIssues.length') || content.includes('remaining blocker'),
    `Expected "${sharedCtx.filePath}" review failure message to include blocker count`,
  );
});

Then('the workflow exits with code 1 when review fails', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('process.exit(1)'),
    `Expected "${sharedCtx.filePath}" to exit with code 1 when review fails`,
  );
});
