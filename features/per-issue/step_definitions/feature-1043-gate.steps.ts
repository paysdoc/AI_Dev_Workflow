/**
 * Gate scenarios of feature-1043: the line the application-type step of a workflow's start writes to the workflow's
 * execution log, which describes the type by its profile. The scenario starts the workflow with feature-991's steps and reads
 * the line back here.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { Platform } from '../../../adws/core/applicationType.ts';

import { requireWorkflow } from './feature-988-phase.steps.ts';
import { requireGateLine, s } from './feature-1043-world.ts';

const SCENARIOS_MD = '.adw/scenarios.md';

function executionLog(): string {
  const logFile = path.join(requireWorkflow().config.orchestratorStatePath, 'execution.log');
  return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '';
}

function namesPlatform(line: string, platform: string): boolean {
  return new RegExp(`\\b${platform}\\b`, 'i').test(line);
}

Then("the workflow's execution log has a line for the application type {string}", function (applicationType: string) {
  const prefix = `Application type ${applicationType}: `;
  const log = executionLog();
  const line = log.split('\n').find(candidate => candidate.includes(prefix));
  assert.ok(line, `Expected the execution log to have a line for the application type "${applicationType}", got:\n${log}`);
  s.gateLine = line.slice(line.indexOf(prefix) + prefix.length);
});

Then('that line says the scenarios run with the runner that {string} describes', function (file: string) {
  assert.strictEqual(file, SCENARIOS_MD, `The descriptor runner is the one "${SCENARIOS_MD}" describes`);
  const line = requireGateLine();
  assert.ok(
    line.includes(`scenarios run with the scenario runner that \`${file}\` describes`),
    `Expected the line to say that the scenarios run with the runner that "${file}" describes, got: ${line}`,
  );
});

Then('that line says the evidence is per-issue scenario images', function () {
  const line = requireGateLine();
  assert.ok(line.includes('evidence: per-issue scenario images'), `Expected the line to say that the evidence is per-issue scenario images, got: ${line}`);
});

Then('that line names the platforms {string} and {string}', function (first: string, second: string) {
  const line = requireGateLine();
  assert.ok(line.includes(`platforms: ${first}, ${second}`), `Expected the line to name the platforms "${first}" and "${second}", got: ${line}`);
});

Then('that line names no platform', function () {
  const line = requireGateLine();
  const named = Object.values(Platform).filter(platform => namesPlatform(line, platform));
  assert.ok(!line.includes('platforms'), `Expected the line to name no platform, got: ${line}`);
  assert.deepStrictEqual(named, [], `Expected the line to name no platform, but it names ${named.join(', ')}: ${line}`);
});
