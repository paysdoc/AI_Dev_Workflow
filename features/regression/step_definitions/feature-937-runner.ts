/**
 * The workflow's repository is a web repository, the only kind whose scenario proof carries images: ADW runs its
 * scenarios with ADW's Playwright project, and only the images attached to the issue's own scenario in the JUnit report
 * are the evidence the review comment shows. Instead of installing Playwright, the scenarios put a stand-in `npx` first on
 * `PATH`. Asked for the issue's tag, it copies the proof run into `ADW_PROOF_DIR` and attaches every file of it to the
 * issue's scenario, as Playwright attaches the screenshots it takes; asked for the regression tag, it reports the
 * regression scenario with no attachment.
 */

import * as fs from 'fs';
import * as path from 'path';

import { ADW_PLAYWRIGHT_PROJECT_DIR, ADW_PLAYWRIGHT_STEP_DEF_DIR } from '../../../adws/core/adwPlaywrightProject.ts';

const FEATURE_FILE = 'proof.feature';
const FEATURE_NAME = "The workflow's repository";
const REGRESSION_SCENARIO = 'A scenario of the regression suite';
const ISSUE_SCENARIO = 'The scenario of the issue';
// ADW's Playwright project names a test after the Feature and the scenario, joined as playwright-bdd joins them.
const TITLE_SEPARATOR = ' › ';

/** Plain `function`/`var` source: the program runs under whichever runtime the harness runs under, with no loader. */
const PROGRAM_BODY = `
'use strict';
var fs = require('fs');
var path = require('path');

var args = process.argv.slice(2);

function xml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function grepTag() {
  var value = String(args[args.indexOf('--grep') + 1] || '');
  return value.replace(/^@/, '').replace(/\\\\b$/, '');
}

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce(function (files, entry) {
    var entryPath = path.join(directory, entry.name);
    return files.concat(entry.isDirectory() ? filesBelow(entryPath) : [entryPath]);
  }, []);
}

function leaveProofRun(proofDirectory) {
  return filesBelow(CONFIG.proofRunDir).map(function (file) {
    var copy = path.join(proofDirectory, path.relative(CONFIG.proofRunDir, file));
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(file, copy);
    return copy;
  });
}

// Playwright lists each attachment as a "[[ATTACHMENT|<path>]]" line, relative to the directory of the report.
function testCase(scenario, attachments, reportDirectory) {
  var lines = attachments.map(function (file) { return '[[ATTACHMENT|' + path.relative(reportDirectory, file) + ']]'; });
  var output = lines.length === 0 ? '' : '<system-out><![CDATA[\\n' + lines.join('\\n') + '\\n]]></system-out>';
  return '<testcase name="' + xml(scenario.title) + '" classname="' + xml(CONFIG.featureFile) + '" time="0.01">' + output + '</testcase>';
}

function runTag(tag) {
  if (!Object.prototype.hasOwnProperty.call(CONFIG.scenarios, tag)) {
    process.stdout.write('Error: No tests found\\n');
    process.exitCode = 1;
    return;
  }
  var scenario = CONFIG.scenarios[tag];
  var reportPath = process.env.ADW_JUNIT_REPORT_PATH;
  var attachments = scenario.leavesProofRun ? leaveProofRun(process.env.ADW_PROOF_DIR) : [];
  var suite = '<testsuite name="' + xml(CONFIG.featureFile) + '" tests="1" failures="0">' + testCase(scenario, attachments, path.dirname(reportPath)) + '</testsuite>';
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, '<?xml version="1.0" encoding="UTF-8"?>\\n<testsuites tests="1" failures="0">' + suite + '</testsuites>\\n');
  process.stdout.write('1 passed\\n');
}

if (args[0] === 'playwright' && args[1] === 'test') runTag(grepTag());
`;

interface StandInScenario {
  readonly title: string;
  readonly leavesProofRun: boolean;
}

function featureSource(issueNumber: number): string {
  return [
    `Feature: ${FEATURE_NAME}`,
    '',
    '  @regression',
    `  Scenario: ${REGRESSION_SCENARIO}`,
    '    Given the application is running',
    '',
    `  @adw-${issueNumber}`,
    `  Scenario: ${ISSUE_SCENARIO}`,
    '    Given the application is running',
    '',
  ].join('\n');
}

/** What `adw_init` and the worktree's install leave in a web repository; the installed packages make the run skip `npm ci`. */
export function writePlaywrightProject(worktreePath: string, issueNumber: number): void {
  const projectDir = path.join(worktreePath, ADW_PLAYWRIGHT_PROJECT_DIR);
  fs.mkdirSync(path.join(projectDir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, FEATURE_FILE), featureSource(issueNumber));
  const stepDefinitionDir = path.join(worktreePath, ADW_PLAYWRIGHT_STEP_DEF_DIR);
  fs.mkdirSync(stepDefinitionDir, { recursive: true });
  fs.writeFileSync(path.join(stepDefinitionDir, 'proof.steps.ts'), "// The repository's step definitions.\n");
}

// A shebang cannot carry a path with spaces; `env` finds node on PATH instead.
function interpreterLine(): string {
  return /\s/.test(process.execPath) ? '#!/usr/bin/env node' : `#!${process.execPath}`;
}

/** Writes the stand-in `npx` into `binDir`; every run copies what `proofRunDir` holds at that moment. */
export function installStandInRunner(binDir: string, proofRunDir: string, issueNumber: number): void {
  const scenarios: Readonly<Record<string, StandInScenario>> = {
    regression: { title: [FEATURE_NAME, REGRESSION_SCENARIO].join(TITLE_SEPARATOR), leavesProofRun: false },
    [`adw-${issueNumber}`]: { title: [FEATURE_NAME, ISSUE_SCENARIO].join(TITLE_SEPARATOR), leavesProofRun: true },
  };
  const config = { proofRunDir, featureFile: FEATURE_FILE, scenarios };
  fs.writeFileSync(path.join(binDir, 'npx'), `${interpreterLine()}\nvar CONFIG = ${JSON.stringify(config)};\n${PROGRAM_BODY}`, { mode: 0o755 });
}

function restoreVariable(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/**
 * `PATH` leads with the stand-in only while `run` does. The Cucumber run's `NODE_OPTIONS="--import tsx"` is cleared
 * meanwhile: the stand-in is a Node program started in the worktree, where tsx cannot be resolved.
 */
export async function withStandInRunner<T>(binDir: string, run: () => Promise<T>): Promise<T> {
  const savedPath = process.env['PATH'];
  const savedNodeOptions = process.env['NODE_OPTIONS'];
  process.env['PATH'] = `${binDir}${path.delimiter}${savedPath ?? ''}`;
  delete process.env['NODE_OPTIONS'];
  try {
    return await run();
  } finally {
    restoreVariable('PATH', savedPath);
    restoreVariable('NODE_OPTIONS', savedNodeOptions);
  }
}
