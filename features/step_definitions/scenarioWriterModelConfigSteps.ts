import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();

// Shared context for this step file
let configContent = '';
let scenarioAgentContent = '';
let activeMap: 'standard' | 'fast' = 'standard';

// ── @regression: SLASH_COMMAND_MODEL_MAP assigns opus to /scenario_writer ─────

When(
  'searching for the SLASH_COMMAND_MODEL_MAP entry for {string}',
  function (this: Record<string, string>, command: string) {
    const filePath = 'adws/core/modelRouting.ts';
    const fullPath = join(ROOT, filePath);
    assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
    configContent = readFileSync(fullPath, 'utf-8');
    this.fileContent = configContent;
    this.filePath = filePath;
    this.command = command;
    this.activeMap = 'standard';
    activeMap = 'standard';
  },
);

Then('the model is {string}', function (this: Record<string, string>, expectedModel: string) {
  // Determine which map to check
  const mapName = (this.activeMap ?? activeMap) === 'fast'
    ? 'SLASH_COMMAND_MODEL_MAP_FAST'
    : 'SLASH_COMMAND_MODEL_MAP';
  const command = this.command;
  const content = this.fileContent ?? configContent;

  // Find the block for this map
  const mapStart = content.indexOf(`export const ${mapName}`);
  assert.ok(mapStart !== -1, `Expected ${mapName} to be defined in config.ts`);

  // Find the closing brace of the map
  const mapBlock = content.slice(mapStart, content.indexOf('};', mapStart) + 2);

  // Match: '/scenario_writer': 'opus'  (with possible whitespace variations)
  const pattern = new RegExp(`'${command.replace('/', '\\/')}'\\s*:\\s*'${expectedModel}'`);
  assert.ok(
    pattern.test(mapBlock),
    `Expected ${mapName}['${command}'] to be '${expectedModel}' but did not find the pattern in the map block`,
  );
});

// ── @regression: SLASH_COMMAND_MODEL_MAP_FAST assigns sonnet to /scenario_writer

When(
  'searching for the SLASH_COMMAND_MODEL_MAP_FAST entry for {string}',
  function (this: Record<string, string>, command: string) {
    const filePath = 'adws/core/modelRouting.ts';
    const fullPath = join(ROOT, filePath);
    assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
    configContent = readFileSync(fullPath, 'utf-8');
    this.fileContent = configContent;
    this.filePath = filePath;
    this.command = command;
    this.activeMap = 'fast';
    activeMap = 'fast';
  },
);

// ── @regression: getModelForCommand returns correct model ─────────────────────

Given(
  'the issue body does not contain {string} or {string}',
  function (this: Record<string, string>, _kw1: string, _kw2: string) {
    const filePath = 'adws/core/modelRouting.ts';
    const fullPath = join(ROOT, filePath);
    assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
    configContent = readFileSync(fullPath, 'utf-8');
    this.fileContent = configContent;
    this.filePath = filePath;
    this.issueMode = 'standard';
    activeMap = 'standard';
  },
);

Given('the issue body contains {string}', function (this: Record<string, string>, _keyword: string) {
  const filePath = 'adws/core/modelRouting.ts';
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
  configContent = readFileSync(fullPath, 'utf-8');
  this.fileContent = configContent;
  this.filePath = filePath;
  this.issueMode = 'fast';
  activeMap = 'fast';
});

When(
  'getModelForCommand is called with {string}',
  function (this: Record<string, string>, command: string) {
    this.command = command;
  },
);

Then('it returns {string}', function (this: Record<string, unknown>, expectedModel: string) {
  // Branch-name assembly context (set by deterministicBranchNameAssemblySteps)
  if (this.assemblyResult !== undefined || this.assemblyError !== undefined) {
    const assemblyError = this.assemblyError as Error | undefined;
    const assemblyResult = this.assemblyResult as string | undefined;
    assert.ok(assemblyError === undefined, `Expected no error but got: ${assemblyError?.message}`);
    assert.strictEqual(assemblyResult, expectedModel,
      `Expected generateBranchName to return "${expectedModel}", got "${assemblyResult}"`);
    return;
  }

  // Model config context (original logic)
  const mapName = (this.issueMode ?? (activeMap === 'fast' ? 'fast' : 'standard')) === 'fast'
    ? 'SLASH_COMMAND_MODEL_MAP_FAST'
    : 'SLASH_COMMAND_MODEL_MAP';
  const command = this.command as string;
  const content = (this.fileContent as string) ?? configContent;

  const mapStart = content.indexOf(`export const ${mapName}`);
  assert.ok(mapStart !== -1, `Expected ${mapName} to be defined in config.ts`);
  const mapBlock = content.slice(mapStart, content.indexOf('};', mapStart) + 2);

  const pattern = new RegExp(`'${command.replace('/', '\\/')}'\\s*:\\s*'${expectedModel}'`);
  assert.ok(
    pattern.test(mapBlock),
    `Expected getModelForCommand('${command}') to return '${expectedModel}' via ${mapName}`,
  );
});

// ── Non-@regression steps (pass-through) ──────────────────────────────────────

When(
  /^the scenario agent is invoked with a standard issue \(no \/fast keyword\)$/,
  function (this: Record<string, string>) {
    const filePath = 'adws/agents/scenarioAgent.ts';
    const fullPath = join(ROOT, filePath);
    assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
    scenarioAgentContent = readFileSync(fullPath, 'utf-8');
    this.fileContent = scenarioAgentContent;
    this.filePath = filePath;
  },
);

When(
  'the scenario agent is invoked with an issue body containing {string}',
  function (this: Record<string, string>, _keyword: string) {
    const filePath = 'adws/agents/scenarioAgent.ts';
    const fullPath = join(ROOT, filePath);
    assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
    scenarioAgentContent = readFileSync(fullPath, 'utf-8');
    this.fileContent = scenarioAgentContent;
    this.filePath = filePath;
  },
);
