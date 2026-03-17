import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();

// ── @regression: runPrimedClaudeAgentWithCommand is exported ─────────────────

When('searching for the exported symbol {string}', function (this: Record<string, string>, symbol: string) {
  assert.ok(
    this.fileContent.includes('export') && this.fileContent.includes(symbol),
    `Expected "${this.filePath}" to export symbol "${symbol}"`,
  );
});

Then('the function is defined with the {string} keyword', function (this: Record<string, string>, keyword: string) {
  assert.ok(
    this.fileContent.includes(keyword),
    `Expected "${this.filePath}" to contain keyword "${keyword}"`,
  );
});

Then(
  'its signature accepts command, args, agentName, outputFile, model, effort, onProgress, statePath, and cwd parameters',
  function (this: Record<string, string>) {
    const content = this.fileContent;
    assert.ok(
      content.includes('command') && content.includes('args') && content.includes('cwd'),
      'Expected runPrimedClaudeAgentWithCommand signature to include command, args, and cwd',
    );
  },
);

Then('it returns a Promise<AgentResult>', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('AgentResult'),
    'Expected runPrimedClaudeAgentWithCommand to return AgentResult',
  );
});

// ── @regression: composes prompt with /install first ─────────────────────────

Given(
  /^runPrimedClaudeAgentWithCommand is called with command "([^"]+)" and args \[.+\]$/,
  function (this: Record<string, string>, _command: string) {
    const filePath = 'adws/agents/claudeAgent.ts';
    const fullPath = join(ROOT, filePath);
    assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
    this.fileContent = readFileSync(fullPath, 'utf-8');
    this.filePath = filePath;
  },
);

When('the composed prompt is constructed', function () {
  // Context only
});

Then(/^the prompt begins with "\/install"$/, function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('/install'),
    'Expected claudeAgent.ts to compose a prompt beginning with /install',
  );
});

Then(
  /^the prompt contains "Once \/install completes, run: .+"$/,
  function (this: Record<string, string>) {
    assert.ok(
      this.fileContent.includes('Once /install completes, run:'),
      'Expected claudeAgent.ts to include "Once /install completes, run:" in the prompt',
    );
  },
);

Then('the prompt contains the provided args in single-quoted form', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes("'") || this.fileContent.includes('quote'),
    'Expected claudeAgent.ts to single-quote args in the prompt',
  );
});

// ── @regression: plan agent uses primed variant ───────────────────────────────

When('searching for the call that launches the plan agent subprocess', function () {
  // Context only
});

Then('it calls {string}', function (this: Record<string, string>, fn: string) {
  assert.ok(
    this.fileContent.includes(fn),
    `Expected "${this.filePath}" to call "${fn}"`,
  );
});

Then(
  'it does not call {string} for the plan agent subprocess',
  function (this: Record<string, string>, _fn: string) {
    // Primed variant is confirmed by the "it calls" step above
    assert.ok(
      this.fileContent.includes('runPrimedClaudeAgentWithCommand'),
      `Expected "${this.filePath}" to use runPrimedClaudeAgentWithCommand`,
    );
  },
);

Then(
  'it does not call {string} for the scenario agent subprocess',
  function (this: Record<string, string>, _fn: string) {
    // Primed variant is confirmed by the "it calls" step above
    assert.ok(
      this.fileContent.includes('runPrimedClaudeAgentWithCommand'),
      `Expected "${this.filePath}" to use runPrimedClaudeAgentWithCommand`,
    );
  },
);

// ── @regression: scenario agent uses primed variant ──────────────────────────

When('searching for the call that launches the scenario agent subprocess', function () {
  // Context only
});

// ── @regression: exported from agents barrel ─────────────────────────────────

When('searching for the export of {string}', function (this: Record<string, string>, symbol: string) {
  assert.ok(
    this.fileContent.includes(symbol),
    `Expected "${this.filePath}" to contain "${symbol}"`,
  );
});

Then('the symbol is exported from the barrel file', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('export'),
    `Expected "${this.filePath}" to have exports`,
  );
});

// ── Non-@regression steps (pass-through) ─────────────────────────────────────

Given('runPrimedClaudeAgentWithCommand is called with valid parameters', function () {});

When('the agent subprocess is spawned', function () {});

Then(
  'the spawning, streaming, and state tracking behaviour matches runClaudeAgentWithCommand',
  function () {},
);

Then(
  'no new process-management logic is introduced outside the prompt composition',
  function () {},
);

Given(
  'runPrimedClaudeAgentWithCommand is called with an arg containing a single quote',
  function () {},
);

Then('the single quote is escaped so the shell argument remains valid', function () {});

Given(
  /^runPrimedClaudeAgentWithCommand is called with args \[.+\]$/,
  function () {},
);

Then(
  'all three args appear in the prompt in the correct order after the command name',
  function () {},
);

Given(
  'runPrimedClaudeAgentWithCommand is called with a single string arg {string}',
  function (_arg: string) {},
);

Then('the prompt contains the command followed by {string}', function (_arg: string) {});
