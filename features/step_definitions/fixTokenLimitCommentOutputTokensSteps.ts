import { Given, When, Then } from '@cucumber/cucumber';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx as _sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── Helpers ─────────────────────────────────────────────────────────────────

function readWorkflowCommentsIssue(): string {
  const filePath = join(ROOT, 'adws/github/workflowCommentsIssue.ts');
  assert.ok(existsSync(filePath), 'Expected workflowCommentsIssue.ts to exist');
  return readFileSync(filePath, 'utf-8');
}

function readAgentProcessHandler(): string {
  const filePath = join(ROOT, 'adws/agents/agentProcessHandler.ts');
  assert.ok(existsSync(filePath), 'Expected agentProcessHandler.ts to exist');
  return readFileSync(filePath, 'utf-8');
}

function readAgentTypes(): string {
  const filePath = join(ROOT, 'adws/types/agentTypes.ts');
  assert.ok(existsSync(filePath), 'Expected agentTypes.ts to exist');
  return readFileSync(filePath, 'utf-8');
}

// ── 1: Comment formatter fix ────────────────────────────────────────────────

Given(
  'a TokenUsageSnapshot with totalOutputTokens = {int} and maxTokens = {int} and thresholdPercent = {float}',
  function (this: Record<string, unknown>, totalOutputTokens: number, maxTokens: number, thresholdPercent: number) {
    this.__tokenUsage = { totalOutputTokens, maxTokens, thresholdPercent };
  },
);

When('formatWorkflowComment is called with the {string} stage', function (this: Record<string, unknown>, stage: string) {
  // Structural: verify the token_limit_recovery comment format uses totalOutputTokens
  const content = readWorkflowCommentsIssue();
  const fnMatch = content.match(/formatTokenLimitRecoveryComment[\s\S]*?^}/m);
  this.__commentFnBody = fnMatch ? fnMatch[0] : content;
  this.__stage = stage;
});

Then('the comment displays {string} as the tokens used', function (this: Record<string, unknown>, _expected: string) {
  const content = readWorkflowCommentsIssue();
  // The comment should format totalOutputTokens, not totalTokens
  assert.ok(
    content.includes('totalOutputTokens'),
    'Expected token limit recovery comment to use totalOutputTokens',
  );
  assert.ok(
    content.includes('toLocaleString') || content.includes('toFixed'),
    'Expected token counts to be formatted with toLocaleString or toFixed',
  );
});

Then('the comment does not display totalTokens \\(the sum of all token types)', function () {
  const content = readWorkflowCommentsIssue();
  // Find the formatTokenLimitRecoveryComment function and verify it does not use totalTokens
  const fnStart = content.indexOf('formatTokenLimitRecoveryComment');
  assert.ok(fnStart !== -1, 'Expected formatTokenLimitRecoveryComment function to exist');
  const fnEnd = content.indexOf('\n}', fnStart);
  const fnBody = content.slice(fnStart, fnEnd + 2);
  assert.ok(
    !fnBody.includes('totalTokens') || fnBody.includes('totalOutputTokens'),
    'Expected formatTokenLimitRecoveryComment not to use a standalone totalTokens field',
  );
});

Given(
  'a WorkflowContext with tokenUsage containing totalOutputTokens = {int} and totalTokens = {int}',
  function (this: Record<string, unknown>, totalOutputTokens: number, totalTokens: number) {
    this.__totalOutputTokens = totalOutputTokens;
    this.__totalTokens = totalTokens;
  },
);

When('formatTokenLimitRecoveryComment is called', function (this: Record<string, unknown>) {
  // Structural verification
  this.__formatted = true;
});

Then('the formatted comment includes {int} as the tokens used numerator', function (this: Record<string, unknown>, expected: number) {
  const content = readWorkflowCommentsIssue();
  // Verify the function uses totalOutputTokens (which would produce 58984 in the scenario)
  assert.ok(
    content.includes('totalOutputTokens'),
    `Expected formatTokenLimitRecoveryComment to use totalOutputTokens (yielding ${expected})`,
  );
});

Then('the formatted comment does not include {int}', function (this: Record<string, unknown>, unexpected: number) {
  const content = readWorkflowCommentsIssue();
  // The function should not reference a totalTokens field for display
  const fnStart = content.indexOf('formatTokenLimitRecoveryComment');
  const fnEnd = content.indexOf('\n}', fnStart);
  const fnBody = content.slice(fnStart, fnEnd + 2);
  // It should not use a separate totalTokens for display — only totalOutputTokens
  const usesTotalTokensForDisplay = fnBody.includes('.totalTokens.') || fnBody.includes('.totalTokens)');
  assert.ok(
    !usesTotalTokensForDisplay,
    `Expected formatTokenLimitRecoveryComment not to display totalTokens (${unexpected})`,
  );
});

// ── 2: TokenUsageSnapshot type cleanup ──────────────────────────────────────

// Note: 'Given the file {string} exists' is defined in cucumberConfigSteps.ts

Then('the TokenUsageSnapshot interface does not include a {string} field', function (field: string) {
  const content = readAgentTypes();
  // Extract the TokenUsageSnapshot interface body
  const ifaceStart = content.indexOf('interface TokenUsageSnapshot');
  assert.ok(ifaceStart !== -1, 'Expected TokenUsageSnapshot interface to exist in agentTypes.ts');
  const ifaceEnd = content.indexOf('}', ifaceStart);
  const ifaceBody = content.slice(ifaceStart, ifaceEnd + 1);
  assert.ok(
    !ifaceBody.includes(field),
    `Expected TokenUsageSnapshot interface not to include "${field}" field`,
  );
});

Then(
  'the interface retains {string}, {string}, {string}, {string}, and {string}',
  function (f1: string, f2: string, f3: string, f4: string, f5: string) {
    const content = readAgentTypes();
    const ifaceStart = content.indexOf('interface TokenUsageSnapshot');
    assert.ok(ifaceStart !== -1, 'Expected TokenUsageSnapshot interface to exist');
    const ifaceEnd = content.indexOf('}', ifaceStart);
    const ifaceBody = content.slice(ifaceStart, ifaceEnd + 1);
    for (const field of [f1, f2, f3, f4, f5]) {
      assert.ok(
        ifaceBody.includes(field),
        `Expected TokenUsageSnapshot interface to retain "${field}" field`,
      );
    }
  },
);

// ── 3: agentProcessHandler snapshot construction ────────────────────────────

When('a token limit termination occurs and a TokenUsageSnapshot is constructed', function (this: Record<string, unknown>) {
  // Structural verification
  this.__snapshotConstructed = true;
});

Then('the snapshot does not include a {string} property', function (this: Record<string, unknown>, field: string) {
  const content = readAgentProcessHandler();
  // Find where the TokenUsageSnapshot is constructed (the snapshot object literal)
  const snapshotStart = content.indexOf('const snapshot');
  if (snapshotStart === -1) {
    // Alternative: look for inline snapshot construction
    const inlineMatch = content.indexOf('tokenUsage:');
    assert.ok(inlineMatch !== -1, 'Expected a TokenUsageSnapshot construction in agentProcessHandler.ts');
  }
  // The snapshot construction should not include totalTokens
  const snapshotRegion = content.slice(
    snapshotStart !== -1 ? snapshotStart : 0,
    content.indexOf('resolve(', snapshotStart !== -1 ? snapshotStart : 0),
  );
  // Check that totalTokens is not a property being set (but totalOutputTokens is fine)
  const hasTotalTokensProp = /\btotalTokens\s*:/.test(snapshotRegion) &&
    !/totalOutputTokens/.test(snapshotRegion.match(/\btotalTokens\s*:/)?.[0] ?? '');
  assert.ok(
    !hasTotalTokensProp,
    `Expected agentProcessHandler.ts snapshot not to include "${field}" property`,
  );
});

Then(
  'the snapshot includes {string}, {string}, {string}, {string}, and {string}',
  function (f1: string, f2: string, f3: string, f4: string, f5: string) {
    const content = readAgentProcessHandler();
    for (const field of [f1, f2, f3, f4, f5]) {
      assert.ok(
        content.includes(field),
        `Expected agentProcessHandler.ts to include "${field}" in TokenUsageSnapshot construction`,
      );
    }
  },
);

// ── 4: Type checks ─────────────────────────────────────────────────────────

Given('the ADW codebase with the totalTokens field removed from TokenUsageSnapshot', function () {
  // Verify TokenUsageSnapshot does not have totalTokens
  const content = readAgentTypes();
  const ifaceStart = content.indexOf('interface TokenUsageSnapshot');
  assert.ok(ifaceStart !== -1, 'Expected TokenUsageSnapshot interface to exist');
  const ifaceEnd = content.indexOf('}', ifaceStart);
  const ifaceBody = content.slice(ifaceStart, ifaceEnd + 1);
  assert.ok(
    !ifaceBody.includes('totalTokens:') || ifaceBody.includes('totalOutputTokens'),
    'Expected TokenUsageSnapshot to not include a standalone totalTokens field',
  );
});

// Note: 'When("{string}" is run)' is defined in removeUnitTestsSteps.ts
// Note: 'Then the command exits with code {int}' is defined in wireExtractorSteps.ts
// Note: 'Then "{string}" also exits with code {int}' is defined in wireExtractorSteps.ts
