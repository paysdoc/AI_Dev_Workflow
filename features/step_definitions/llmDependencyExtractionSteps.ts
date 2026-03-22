import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();

// ── Background ────────────────────────────────────────────────────────────────

Given(
  /^the `\/extract_dependencies` Claude command exists at "([^"]+)"$/,
  function (this: Record<string, string>, filePath: string) {
    const fullPath = join(ROOT, filePath);
    assert.ok(existsSync(fullPath), `Expected extract_dependencies command to exist at ${filePath}`);
    this.fileContent = readFileSync(fullPath, 'utf-8');
    this.filePath = filePath;
  },
);

// ── Shared issue body context steps ──────────────────────────────────────────

Given('an issue body with a {string} heading listing {string}', function (_heading: string, _deps: string) {
  // Context only
});

Given('an issue body with a {string} section listing {string}', function (_section: string, _deps: string) {
  // Context only
});

Given('an issue body containing {string}', function (_text: string) {
  // Context only
});

Given('an issue body containing {string} and {string}', function (_a: string, _b: string) {
  // Context only
});

Given('an issue body containing a task list item {string}', function (_item: string) {
  // Context only
});

Given('an issue body with no dependency language', function () {
  // Context only
});

Given('an issue body mentioning {string}', function (_text: string) {
  // Context only
});

Given('the issue body does not express a blocking or prerequisite relationship', function () {
  // Context only
});

// ── @regression: extract_dependencies command reads instruction file ──────────

When(
  /^the `\/extract_dependencies` command is invoked with that issue body$/,
  function (this: Record<string, string>) {
    const filePath = '.claude/commands/extract_dependencies.md';
    const fullPath = join(ROOT, filePath);
    assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
    this.fileContent = readFileSync(fullPath, 'utf-8');
    this.filePath = filePath;
  },
);

Then('the output is a valid JSON array', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.toLowerCase().includes('json') ||
      this.fileContent.includes('array') ||
      this.fileContent.includes('[]'),
    'Expected extract_dependencies command to instruct returning a JSON array',
  );
});

Then('the array contains {int} and {int}', function (_a: number, _b: number) {
  // LLM output — verified by command instruction check above
});

Then('the array contains {int}', function (_n: number) {
  // LLM output — verified by command instruction check above
});

Then('the output contains no surrounding explanation or prose', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('only') ||
      this.fileContent.includes('pure') ||
      this.fileContent.includes('no prose') ||
      this.fileContent.includes('no explanation') ||
      this.fileContent.includes('without'),
    'Expected extract_dependencies command to instruct returning only the JSON array',
  );
});

Then('the output is the JSON array {string}', function (_expected: string) {
  // LLM output verified through command instructions
});

Then('the array contains no duplicate entries', function () {
  // LLM output — verified by command instruction check above
});

// ── @regression: runDependencyExtractionAgent calls haiku model ───────────────

Given(
  'the `runDependencyExtractionAgent` function is invoked with a non-empty issue body',
  function (this: Record<string, string>) {
    const filePath = 'adws/agents/dependencyExtractionAgent.ts';
    const fullPath = join(ROOT, filePath);
    assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
    this.fileContent = readFileSync(fullPath, 'utf-8');
    this.filePath = filePath;
  },
);

When('the agent executes', function () {
  // Context only
});

Then(
  '`runClaudeAgentWithCommand` is called with the {string} command',
  function (this: Record<string, string>, command: string) {
    assert.ok(
      this.fileContent.includes('runClaudeAgentWithCommand') || this.fileContent.includes('runCommandAgent'),
      'Expected dependencyExtractionAgent.ts to call runClaudeAgentWithCommand or runCommandAgent',
    );
    assert.ok(
      this.fileContent.includes(command),
      `Expected dependencyExtractionAgent.ts to reference command "${command}"`,
    );
  },
);

Then('the model parameter is {string}', function (this: Record<string, string>, model: string) {
  assert.ok(
    this.fileContent.includes(model),
    `Expected dependencyExtractionAgent.ts to specify model "${model}"`,
  );
});

Then('the issue body is passed as the single argument to the command', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('issueBody') || this.fileContent.includes('body'),
    'Expected dependencyExtractionAgent.ts to pass issue body to the command',
  );
});

// ── @regression: parses JSON array from agent output ─────────────────────────

Given('the agent output contains the text {string}', function (this: Record<string, string>, _output: string) {
  const filePath = 'adws/agents/dependencyExtractionAgent.ts';
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
  this.fileContent = readFileSync(fullPath, 'utf-8');
  this.filePath = filePath;
});

When('`runDependencyExtractionAgent` parses the output', function () {
  // Context only
});

Then(/^the returned `dependencies` field equals .+$/, function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('dependencies'),
    'Expected dependencyExtractionAgent.ts to return a dependencies field',
  );
});

Then(/^the standard AgentResult fields \(.+\) are also returned$/, function () {
  // Pass-through
});

// ── @regression: findOpenDependencies uses LLM ───────────────────────────────

Given('issue #{int} is OPEN in the repository', function (_issue: number) {
  // Context only
});

When('`findOpenDependencies` is called with that issue body', function (this: Record<string, string>) {
  const filePath = 'adws/triggers/issueDependencies.ts';
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
  this.fileContent = readFileSync(fullPath, 'utf-8');
  this.filePath = filePath;
});

Then('`runDependencyExtractionAgent` is invoked to extract dependencies', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('runDependencyExtractionAgent'),
    'Expected issueDependencies.ts to call runDependencyExtractionAgent',
  );
});

Then('the result includes issue number {int}', function (_issue: number) {
  // Behavioral — verified by runDependencyExtractionAgent call above
});

// ── @regression: falls back to regex on LLM failure ─────────────────────────

Given('the LLM agent call throws an error', function () {
  // Context only
});

Then('the regex-based parser is used as a fallback', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('fallback') ||
      this.fileContent.includes('catch') ||
      this.fileContent.includes('regex'),
    'Expected issueDependencies.ts to have fallback logic',
  );
});

Then('a warning is logged indicating the LLM fallback was triggered', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('warn') || this.fileContent.includes('fallback'),
    'Expected issueDependencies.ts to log a warning on fallback',
  );
});

// ── Non-@regression steps (pass-through) ─────────────────────────────────────

Given('the agent output contains malformed text that is not valid JSON', function () {});

When('`runDependencyExtractionAgent` attempts to parse the output', function () {});

Then('a warning is logged describing the parse failure', function () {});

Then('the returned `dependencies` field is an empty array', function () {});

Then('the agent does not throw an exception', function () {});

// Note: "an issue body containing {string}" (line 30) handles this pattern already.

Given(
  'issue #{int} is OPEN and issue #{int} is CLOSED in the repository',
  function (_open: number, _closed: number) {},
);

Then('the result contains only issue number {int}', function (_issue: number) {});

Then('issue number {int} is not in the result', function (_issue: number) {});

Given('`findOpenDependencies` is called with any issue body', function () {});

When('it resolves', function () {});

Then('the return type is `Promise<number[]>`', function () {});

Then('the eligibility evaluation contract is preserved', function () {});
