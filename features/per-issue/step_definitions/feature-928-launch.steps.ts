/**
 * §4 EVERY CLAUDE PROCESS STARTS STATELESS. Five ways ADW starts the Claude CLI — a pipeline
 * agent, the rate-limit probe, the schema probe, the guardrails probe and the health check's
 * version check — each run against the recording stand-in. The assertions read the full
 * environment each stand-in process received.
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { runClaudeAgentWithCommand } from '../../../adws/agents/claudeAgent.ts';
import { runGuardrailsProbe } from '../../../adws/core/guardrailsProbe.ts';
import { getModelForCommand, getEffortForCommand } from '../../../adws/core/modelRouting.ts';
import { checkClaudeCodeCLI } from '../../../adws/healthCheckChecks.ts';
import { DEFAULT_SCHEMA_PATH } from '../../../adws/jsonl/conformanceCheck.ts';
import { checkClaudeJsonlSchema } from '../../../adws/jsonl/schemaProbe.ts';
import { probeRateLimit } from '../../../adws/triggers/rateLimitProbe.ts';
import { makeTempDir, readRecords } from './feature-928-harness.ts';

async function startPipelineAgent(): Promise<void> {
  await runClaudeAgentWithCommand(
    '/commit',
    ['928'],
    'feature-928-launcher',
    path.join(makeTempDir('launch-logs'), 'agent.jsonl'),
    getModelForCommand('/commit'),
    getEffortForCommand('/commit'),
  );
}

async function startSchemaProbe(): Promise<void> {
  const schemaCopy = path.join(makeTempDir('schema'), 'schema.json');
  fs.copyFileSync(DEFAULT_SCHEMA_PATH, schemaCopy);
  await checkClaudeJsonlSchema(schemaCopy);
}

const LAUNCHERS: Readonly<Record<string, () => Promise<unknown>>> = {
  'pipeline agent spawn': startPipelineAgent,
  'rate-limit probe': async () => probeRateLimit(),
  'schema probe': startSchemaProbe,
  'guardrails probe': runGuardrailsProbe,
  "health check's Claude CLI check": async () => checkClaudeCodeCLI(),
};

When('ADW starts the Claude CLI through the {string}', async function (launcher: string) {
  const start = LAUNCHERS[launcher];
  assert.ok(start, `Unknown launcher "${launcher}". Known: ${Object.keys(LAUNCHERS).join(', ')}`);
  await start();
});

function recordedEnvironments(): Readonly<Record<string, string>>[] {
  const records = readRecords();
  assert.ok(records.length > 0, 'Expected ADW to have started the Claude CLI at least once, but no process was recorded');
  return records.map((record) => record.env);
}

Then('every Claude CLI process ADW started had {string} set to {string}', function (name: string, value: string) {
  const actual = recordedEnvironments().map((env) => env[name]);
  assert.deepStrictEqual(
    actual,
    actual.map(() => value),
    `Expected every process to have ${name}=${value}. Values by process: ${JSON.stringify(actual)}`,
  );
});

Then('no Claude CLI process ADW started had {string} set', function (name: string) {
  const leaking = recordedEnvironments().filter((env) => name in env);
  assert.strictEqual(leaking.length, 0, `Expected ${name} to be absent from every process's environment, but ${leaking.length} process(es) received it`);
});
