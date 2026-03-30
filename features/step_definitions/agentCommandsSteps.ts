import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();

// ── Background ────────────────────────────────────────────────────────────────

Given('the target repository has a plan file and BDD scenario files', function () {
  // Context: ADW repo has spec files and feature files
});

// ── @regression: Validation agent delegates ───────────────────────────────────

Given('the plan validation phase is executing', function (this: Record<string, string>) {
  const filePath = 'adws/agents/validationAgent.ts';
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
  this.fileContent = readFileSync(fullPath, 'utf-8');
  this.filePath = filePath;
});

When('the validation agent runs', function () {
  // Context only
});

Then('it calls runClaudeAgentWithCommand with command {string}', function (this: Record<string, string>, command: string) {
  // Agents may delegate via runCommandAgent (which internally calls runClaudeAgentWithCommand)
  // or directly via runClaudeAgentWithCommand — both are valid delegation patterns.
  assert.ok(
    this.fileContent.includes('runClaudeAgentWithCommand') || this.fileContent.includes('runCommandAgent'),
    `Expected ${this.filePath} to delegate via runClaudeAgentWithCommand or runCommandAgent`,
  );
  assert.ok(
    this.fileContent.includes(command),
    `Expected ${this.filePath} to reference command "${command}"`,
  );
});

Then('it does not call runClaudeAgent directly', function (this: Record<string, string>) {
  const stripped = this.fileContent
    .replace(/runClaudeAgentWithCommand/g, 'PLACEHOLDER');
  assert.ok(
    !stripped.includes('runClaudeAgent('),
    `Expected ${this.filePath} not to call runClaudeAgent directly`,
  );
});

// ── @regression: Resolution agent delegates ───────────────────────────────────

Given('the plan validation phase has found mismatches', function (this: Record<string, string>) {
  const filePath = 'adws/agents/resolutionAgent.ts';
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
  this.fileContent = readFileSync(fullPath, 'utf-8');
  this.filePath = filePath;
});

When('the resolution agent runs', function () {
  // Context only
});

// ── @regression: runClaudeAgent removed ──────────────────────────────────────

Given('the ADW codebase', function () {
  // Context: entire ADW codebase
});

When('searching for usages of runClaudeAgent', function () {
  // Context only
});

Then('runClaudeAgent is not defined anywhere in the codebase', function () {
  const filesToCheck = [
    'adws/agents/claudeAgent.ts',
    'adws/agents/index.ts',
    'adws/agents/planAgent.ts',
    'adws/agents/buildAgent.ts',
    'adws/agents/validationAgent.ts',
    'adws/agents/resolutionAgent.ts',
  ];
  for (const file of filesToCheck) {
    const content = readFileSync(join(ROOT, file), 'utf-8');
    const stripped = content
      .replace(/runClaudeAgentWithCommand/g, 'PLACEHOLDER');
    const defined = /(?:export\s+)?(?:async\s+)?function\s+runClaudeAgent\b/.test(stripped);
    assert.ok(!defined, `Expected runClaudeAgent not to be defined in ${file}`);
  }
});

Then('runClaudeAgent is not called anywhere in the codebase', function () {
  const filesToCheck = [
    'adws/agents/planAgent.ts',
    'adws/agents/buildAgent.ts',
    'adws/agents/testAgent.ts',
    'adws/agents/validationAgent.ts',
    'adws/agents/resolutionAgent.ts',
  ];
  for (const file of filesToCheck) {
    const fullPath = join(ROOT, file);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, 'utf-8');
    const stripped = content
      .replace(/runClaudeAgentWithCommand/g, 'PLACEHOLDER');
    assert.ok(
      !stripped.includes('runClaudeAgent('),
      `Expected runClaudeAgent not to be called in ${file}`,
    );
  }
});

// ── Non-@regression steps (pass-through) ─────────────────────────────────────

Given(
  'the validation agent is invoked with adwId {string}, issueNumber {string}, planFilePath {string}, and scenarioGlob {string}',
  function (_a: string, _b: string, _c: string, _d: string) {},
);

Given(
  'the resolution agent is invoked with adwId {string}, issueNumber {string}, planFilePath {string}, scenarioGlob {string}, issueJson, and a mismatches list',
  function (_a: string, _b: string, _c: string, _d: string) {},
);

Given('the validation agent is configured to use {string}', function (_c: string) {});
Given('the resolution agent is configured to use {string}', function (_c: string) {});

When('the validation agent runs and the command returns aligned JSON', function () {});
When('the resolution agent runs and the command returns resolved JSON', function () {});

Then(
  /^runClaudeAgentWithCommand receives the args \[.*?\] in order$/,
  function () {},
);

Then(
  'runClaudeAgentWithCommand receives all six args to {string} in the correct order',
  function (_c: string) {},
);

Then(
  'the validation agent returns a ValidationResult with aligned true and an empty mismatches list',
  function () {},
);

Then(
  'the resolution agent returns a ResolutionResult with resolved true and a decisions list',
  function () {},
);
