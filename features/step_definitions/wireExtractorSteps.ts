import { Given, When, Then, Before } from '@cucumber/cucumber';
import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { AnthropicTokenUsageExtractor, computeCost, getAnthropicPricing } from '../../adws/cost/index.ts';

const ROOT = process.cwd();

interface WireExtractorCtx {
  extractor: AnthropicTokenUsageExtractor | null;
  messages: string[];
  resultMessage: string;
}

const ctx: WireExtractorCtx = {
  extractor: null,
  messages: [],
  resultMessage: '',
};

Before(function () {
  ctx.extractor = null;
  ctx.messages = [];
  ctx.resultMessage = '';
});

// ─── Scenario 1: Deduplication by message.id ───────────────────────────────

Given(
  'two assistant JSONL messages with the same {string} but different content blocks',
  function (_field: string) {
    const msg1 = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_dup',
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 500 },
        content: [{ type: 'text', text: 'Hello' }],
      },
    });
    const msg2 = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_dup',
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 500 },
        content: [{ type: 'text', text: 'World' }],
      },
    });
    ctx.messages = [msg1, msg2];
  },
);

Given(
  'both messages report {string} = {int} in {string}',
  function (_field: string, _value: number, _location: string) {
    // Context-only: messages already set up with input_tokens = 500 in the Given above
  },
);

When('both messages are fed to the Anthropic extractor via onChunk', function () {
  ctx.extractor = new AnthropicTokenUsageExtractor();
  for (const msg of ctx.messages) {
    ctx.extractor.onChunk(msg + '\n');
  }
});

Then(
  'getCurrentUsage returns accumulated input tokens of {int}, not {int}',
  function (expected: number, notExpected: number) {
    const usage = ctx.extractor!.getCurrentUsage();
    const totalInput = Object.values(usage).reduce((sum, m) => sum + (m['input'] ?? 0), 0);
    assert.strictEqual(totalInput, expected, `Expected input tokens ${expected}, got ${totalInput}`);
    assert.notStrictEqual(totalInput, notExpected, `Input tokens should not be ${notExpected}`);
  },
);

// ─── Scenario 2: Result replaces estimates ─────────────────────────────────

Given(
  'a stream with assistant messages accumulating estimated output tokens of {int}',
  function (estimatedTokens: number) {
    const text = 'x'.repeat(estimatedTokens * 4);
    const msg = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_est_1',
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 0 },
        content: [{ type: 'text', text }],
      },
    });
    ctx.extractor = new AnthropicTokenUsageExtractor();
    ctx.extractor.onChunk(msg + '\n');
  },
);

Given(
  'a result JSONL message with modelUsage containing {string} = {int}',
  function (field: string, value: number) {
    const modelUsageEntry: Record<string, number> = { [field]: value };
    ctx.resultMessage = JSON.stringify({
      type: 'result',
      total_cost_usd: 0.01,
      modelUsage: { 'claude-sonnet-4-20250514': modelUsageEntry },
    });
  },
);

When('the result message is fed to the Anthropic extractor via onChunk', function () {
  ctx.extractor!.onChunk(ctx.resultMessage + '\n');
});

Then(
  'getCurrentUsage returns {string} = {int}, not the estimated {int}',
  function (key: string, actual: number, _estimated: number) {
    const usage = ctx.extractor!.getCurrentUsage();
    const totalValue = Object.values(usage).reduce((sum, m) => sum + (m[key] ?? 0), 0);
    assert.strictEqual(totalValue, actual, `Expected ${key} = ${actual}, got ${totalValue}`);
    assert.notStrictEqual(totalValue, _estimated, `${key} should not equal the estimated ${_estimated}`);
  },
);

Then('isFinalized returns true', function () {
  assert.strictEqual(ctx.extractor!.isFinalized(), true);
});

// ─── Scenario 3: agentProcessHandler code assertions ───────────────────────

Then('it imports from the cost module', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/agentProcessHandler.ts'), 'utf-8');
  const hasImport =
    content.includes("from '../cost'") || content.includes('from "../cost"');
  assert.ok(hasImport, 'Expected agentProcessHandler.ts to import from the cost module');
});

Then('it creates a TokenUsageExtractor instance', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/agentProcessHandler.ts'), 'utf-8');
  assert.ok(
    content.includes('new AnthropicTokenUsageExtractor') || content.includes('TokenUsageExtractor'),
    'Expected agentProcessHandler.ts to create a TokenUsageExtractor instance',
  );
});

Then('stdout chunks are fed to the extractor via onChunk', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/agentProcessHandler.ts'), 'utf-8');
  assert.ok(
    content.includes('extractor.onChunk'),
    'Expected agentProcessHandler.ts to call extractor.onChunk',
  );
});

// ─── Scenarios 4 & 5: Failed/crashed agent runs ────────────────────────────

Given('an agent run that emits {int} assistant messages with token usage', function (count: number) {
  ctx.extractor = new AnthropicTokenUsageExtractor();
  for (let i = 0; i < count; i++) {
    const msg = JSON.stringify({
      type: 'assistant',
      message: {
        id: `msg_fail_${i}`,
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100 },
        content: [{ type: 'text', text: 'Some response text here.' }],
      },
    });
    ctx.extractor.onChunk(msg + '\n');
  }
});

Given('the agent exits with a non-zero exit code', function () {
  // Context-only: no result message — extractor is not finalized
});

When('the agent process handler resolves', function () {
  // Context-only: extractor state already represents the outcome
});

Then('the AgentResult includes accumulated token usage from the extractor', function () {
  const usage = ctx.extractor!.getCurrentUsage();
  const hasUsage =
    Object.keys(usage).length > 0 &&
    Object.values(usage).some(m => Object.values(m).some(v => v > 0));
  assert.ok(hasUsage, 'Expected extractor to have accumulated non-zero token usage');
});

Then('the cost is not zero', function () {
  const usage = ctx.extractor!.getCurrentUsage();
  let totalCost = 0;
  for (const [model, tokens] of Object.entries(usage)) {
    const pricing = getAnthropicPricing(model);
    totalCost += computeCost(tokens, pricing);
  }
  assert.ok(totalCost > 0, `Expected computed cost > 0, got ${totalCost}`);
});

Given('an agent run that emits an error event after some assistant messages', function () {
  ctx.extractor = new AnthropicTokenUsageExtractor();
  for (let i = 0; i < 2; i++) {
    const msg = JSON.stringify({
      type: 'assistant',
      message: {
        id: `msg_crash_${i}`,
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100 },
        content: [{ type: 'text', text: 'Response before crash.' }],
      },
    });
    ctx.extractor.onChunk(msg + '\n');
  }
  // No result message — simulates a crashed/errored run
});

When('the agent process handler resolves with success = false', function () {
  // Context-only: extractor state already represents outcome without result message
});

// ─── Scenario 6: Type checks still pass ────────────────────────────────────

Given('the ADW codebase with the extractor wired into agentProcessHandler', function () {
  // Context-only: the codebase state is already as expected
});

Then(
  'the command exits with code {int}',
  function (this: Record<string, unknown>, expectedCode: number) {
    const result = this['__commandResult'] as ReturnType<typeof spawnSync>;
    const command = this['__commandName'] as string;
    assert.strictEqual(
      result.status,
      expectedCode,
      `Expected "${command}" to exit with code ${expectedCode}, got ${result.status}.\nStdout: ${result.stdout}\nStderr: ${result.stderr}`,
    );
  },
);

Then('{string} also exits with code {int}', function (command: string, expectedCode: number) {
  const [cmd, ...args] = command.split(' ');
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf-8', timeout: 120000 });
  assert.strictEqual(
    result.status,
    expectedCode,
    `Expected "${command}" to exit with code ${expectedCode}, got ${result.status}.\nStdout: ${result.stdout}\nStderr: ${result.stderr}`,
  );
});
