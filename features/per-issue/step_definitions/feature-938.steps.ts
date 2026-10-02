/**
 * Steps for the @adw-938 scenarios: an agent ADW starts for a target repository gets the guardrail
 * settings whatever the repository's .github/adw.yml holds, and the reader and the template no
 * longer know the `guardrails` key. Every assertion reads a runtime artefact: the argv and
 * environment of the stand-in CLI, the probe and alert calls, the captured log, the configuration
 * the reader returns, or the file ADW wrote.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { runClaudeAgentWithCommand } from '../../../adws/agents/claudeAgent.ts';
import { readAdwYmlConfig, writeAdwYmlTemplateIfAbsent, type AdwYmlConfig } from '../../../adws/core/adwYmlConfig.ts';
import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { buildGuardrailsSettings, resolveHookLogDir, type GuardrailsSettings } from '../../../adws/core/guardrailsPayload.ts';
import { getEffortForCommand, getModelForCommand } from '../../../adws/core/modelRouting.ts';
import { flagValue, installStandIn, readRecords, setAdwEnv, type StandInRecord } from './feature-928-harness.ts';
import { installProbe, makeScratchDir, newWorktree, startLogCapture, world938 } from './feature-938-world.ts';

const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop'] as const;

function currentWorktree(): string {
  assert.ok(world938.worktree, 'Expected a worktree to have been set up first');
  return world938.worktree;
}

function currentConfig(): AdwYmlConfig {
  assert.ok(world938.config, "Expected ADW to have read the worktree's configuration first");
  return world938.config;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isInside(directory: string, parent: string): boolean {
  const relative = path.relative(parent, directory);
  return relative === '' || !(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

Given("the operator has not switched off ADW's guardrails for target repositories", function () {
  setAdwEnv('ADW_TARGET_GUARDRAILS', undefined);
});

Given(
  "the operator has switched off ADW's guardrails for target repositories by setting {string} to {string}",
  function (name: string, value: string) {
    setAdwEnv(name, value);
  },
);

Given('a worktree that has no {string}', function (relativePath: string) {
  const worktree = newWorktree();
  assert.ok(!fs.existsSync(path.join(worktree, relativePath)), `Expected the worktree to have no ${relativePath}`);
});

Given('a worktree whose {string} holds:', function (relativePath: string, content: string) {
  const file = path.join(newWorktree(), relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${content}\n`, 'utf-8');
});

Given('the Claude CLI is a stand-in that records how ADW started it', function () {
  installStandIn();
});

Given('the guardrails startup probe passes', function () {
  installProbe({ ok: true });
});

Given('the guardrails startup probe fails', function () {
  installProbe({ ok: false, detail: 'the deny matrix did not hold' });
});

async function startAgents(count: number, selfHost: boolean): Promise<void> {
  startLogCapture();
  const worktree = currentWorktree();
  const outputDir = makeScratchDir('agent-output');
  for (let index = 0; index < count; index += 1) {
    await runClaudeAgentWithCommand(
      '/commit',
      ['938'],
      'feature-938-agent',
      path.join(outputDir, `agent-${index}.jsonl`),
      getModelForCommand('/commit'),
      getEffortForCommand('/commit'),
      undefined,
      undefined,
      worktree,
      undefined,
      undefined,
      undefined,
      { selfHost, adwId: world938.adwId },
    );
  }
}

When('ADW starts an agent in that worktree for a run against a target repository', async function () {
  await startAgents(1, false);
});

When('ADW starts {int} agents in that worktree for a run against a target repository', async function (count: number) {
  await startAgents(count, false);
});

When("ADW starts an agent in that worktree for a run on ADW's own repository", async function () {
  await startAgents(1, true);
});

When("ADW reads that worktree's configuration as a workflow does when it starts", function () {
  startLogCapture();
  world938.config = readAdwYmlConfig(currentWorktree());
});

When('ADW writes its starting {string} into that worktree', function (relativePath: string) {
  startLogCapture();
  const worktree = currentWorktree();
  const result = writeAdwYmlTemplateIfAbsent(worktree);
  assert.deepStrictEqual(result, { created: true }, `Expected ADW to create ${relativePath} in a worktree that has none`);
  assert.ok(fs.existsSync(path.join(worktree, relativePath)), `Expected ADW to have written ${relativePath} into the worktree`);
});

function startedAgents(expected: number): StandInRecord[] {
  const records = readRecords();
  assert.strictEqual(records.length, expected, `Expected ADW to have started the Claude CLI ${expected} time(s), but it started it ${records.length} time(s)`);
  return records;
}

function theAgent(): StandInRecord {
  const [record] = startedAgents(1);
  assert.ok(record, 'Expected one recorded Claude CLI process');
  return record;
}

function registersHookCommand(settings: GuardrailsSettings, event: (typeof HOOK_EVENTS)[number]): boolean {
  return settings.hooks[event].some((entry) => entry.hooks.some((hook) => hook.command.length > 0));
}

function assertGuardrailSettings(record: StandInRecord): void {
  const raw = flagValue(record.argv, '--settings');
  assert.ok(raw !== undefined, `Expected --settings in the argv ADW started the agent with. argv: ${JSON.stringify(record.argv)}`);
  const settings = JSON.parse(raw) as GuardrailsSettings;
  assert.deepStrictEqual(settings, buildGuardrailsSettings({ frameworkRepoRoot: REPO_ROOT }));
  assert.ok(settings.permissions.deny.length > 0, 'Expected the guardrail settings to carry a deny list');
  HOOK_EVENTS.forEach((event) => assert.ok(registersHookCommand(settings, event), `Expected the guardrail settings to register a ${event} hook command`));
}

Then('the agent was started with the guardrail settings ADW builds for target repositories', function () {
  assertGuardrailSettings(theAgent());
});

Then('each of the {int} agents was started with the guardrail settings ADW builds for target repositories', function (count: number) {
  startedAgents(count).forEach(assertGuardrailSettings);
});

Then("the agent's hook logs go to the run's own hook-log directory, outside the worktree", function () {
  const hookLogDir = theAgent().env['CLAUDE_HOOKS_LOG_DIR'];
  assert.ok(hookLogDir !== undefined, 'Expected CLAUDE_HOOKS_LOG_DIR in the environment ADW started the agent with');
  assert.ok(path.isAbsolute(hookLogDir), `Expected CLAUDE_HOOKS_LOG_DIR to be absolute, got "${hookLogDir}"`);
  assert.strictEqual(hookLogDir, resolveHookLogDir(world938.adwId));
  assert.ok(!isInside(hookLogDir, currentWorktree()), `Expected "${hookLogDir}" to lie outside the worktree "${currentWorktree()}"`);
});

Then('the agent was started without guardrail settings', function () {
  const record = theAgent();
  assert.ok(!record.argv.includes('--settings'), `Expected no --settings in the argv. argv: ${JSON.stringify(record.argv)}`);
  assert.ok(!('CLAUDE_HOOKS_LOG_DIR' in record.env), 'Expected no CLAUDE_HOOKS_LOG_DIR in the environment');
});

Then('the guardrails startup probe was run', function () {
  assert.ok(world938.probeCalls > 0, 'Expected the guardrails startup probe to have been run');
});

Then('the guardrails startup probe was not run', function () {
  assert.strictEqual(world938.probeCalls, 0, `Expected the guardrails startup probe not to run, but it ran ${world938.probeCalls} time(s)`);
});

Then('ADW sent one alert that the guardrails startup probe failed', function () {
  assert.strictEqual(world938.alerts.length, 1, `Expected exactly one alert, got ${world938.alerts.length}: ${JSON.stringify(world938.alerts)}`);
  assert.match(world938.alerts[0] ?? '', /guardrails startup probe failed/i);
});

Then('ADW logged at most one line about the {string} key in {string}', function (key: string, file: string) {
  assert.ok(world938.restoreConsole, "Expected the log capture to have started at the scenario's first When step");
  const mentionsKeyAndFile = (line: string): boolean => {
    const lower = line.toLowerCase();
    return lower.includes(key.toLowerCase()) && lower.includes(path.basename(file).toLowerCase());
  };
  const lines = world938.logLines.filter(mentionsKeyAndFile);
  assert.ok(lines.length <= 1, `Expected at most one log line about the "${key}" key in ${file}, got ${lines.length}:\n${lines.join('\n')}`);
});

Then('the configuration ADW read carries no guardrails setting', function () {
  const config = currentConfig();
  const settings = Object.keys(config).filter((name) => /guardrails/i.test(name));
  assert.deepStrictEqual(settings, [], `Expected no guardrails setting in the configuration. Configuration: ${JSON.stringify(config)}`);
});

Then('the configuration ADW read has the unit-test gate disabled', function () {
  assert.strictEqual(currentConfig().unitTests, false, `Expected unitTests to be false. Configuration: ${JSON.stringify(currentConfig())}`);
});

Then('the configuration ADW read has human review of framework-upgrade pull requests switched on', function () {
  assert.strictEqual(currentConfig().hitl, true, `Expected hitl to be true. Configuration: ${JSON.stringify(currentConfig())}`);
});

Then('the {string} ADW wrote offers no {string} key, set or commented out', function (relativePath: string, key: string) {
  const content = fs.readFileSync(path.join(currentWorktree(), relativePath), 'utf-8');
  const keyLine = new RegExp(`^\\s*#?\\s*${escapeRegExp(key)}\\s*:`, 'i');
  const offending = content.split('\n').filter((line) => keyLine.test(line));
  assert.deepStrictEqual(offending, [], `Expected ${relativePath} to offer no "${key}" key, set or commented out. Offending lines:\n${offending.join('\n')}`);
});
