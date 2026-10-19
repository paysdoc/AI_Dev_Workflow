/**
 * The Gradle wrapper of a feature-1044 worktree: a stand-in for `./gradlew` that the scenario command of a "mobile:kotlincm"
 * repository finds in the worktree's root. Each run appends what it was given (arguments, working directory, the `ADW_`
 * variables and the cucumber tag filter) to one file, which the scenarios read back, and writes the JUnit report of the tag it
 * was asked for, or, run for the `test` task, the JUnit report of each test class it was given, where Gradle writes it. Plain
 * `function`/`var` source: it runs under whichever Node the harness runs under, with no loader.
 * No hooks and no steps: any step file may import it.
 */

import * as fs from 'fs';
import * as path from 'path';

/** The screenshot a run takes of each scenario on a platform. */
export interface PlatformScreenshot {
  readonly platform: string;
  readonly screenshot: string;
}

/** One run of the wrapper. */
export interface GradleRun {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /** The value of `-Dcucumber.filter.tags`, such as `@regression`; null when the run was given none. */
  readonly tagFilter: string | null;
}

export interface GradleStandIn {
  readonly callsFile: string;
}

/** The task that runs every module's unit tests, and where under a module Gradle writes their JUnit reports. */
export const TEST_TASK = 'test';
export const TEST_RESULTS_DIRECTORY = 'build/test-results/';
export const TEST_STATUSES = ['passed', 'failed'] as const;

/** A test class of a module, such as `:composeApp`, and the one test case its JUnit report holds. */
export interface TestClassReport {
  readonly module: string;
  readonly testClass: string;
  readonly testCase: string;
  readonly status: (typeof TEST_STATUSES)[number];
}

/** What a run for the `test` task does: the test classes whose reports it writes, and the code it exits with. */
export interface TestTaskRun {
  readonly reports: readonly TestClassReport[];
  readonly exitCode: number;
}

const TAG_FILTER_PROPERTY = '-Dcucumber.filter.tags=';
const NO_TEST_TASK: TestTaskRun = { reports: [], exitCode: 0 };

const WRAPPER_BODY = `
'use strict';
var fs = require('fs');
var path = require('path');

var args = process.argv.slice(2);
var FILTER = ${JSON.stringify(TAG_FILTER_PROPERTY)};
var TEST_TASK = ${JSON.stringify(TEST_TASK)};
var PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function adwVariables() {
  var found = {};
  Object.keys(process.env).forEach(function (name) {
    if (name.indexOf('ADW_') === 0) found[name] = process.env[name];
  });
  return found;
}

function xml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function carriesTag(text, tag) {
  var from = 0;
  for (;;) {
    var at = text.indexOf(tag, from);
    if (at === -1) return false;
    if (!/[A-Za-z0-9_-]/.test(text.charAt(at + tag.length))) return true;
    from = at + 1;
  }
}

function featureFiles(dir, found) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    var full = path.join(dir, entry.name);
    if (entry.isDirectory()) featureFiles(full, found);
    else if (entry.name.slice(-8) === '.feature') found.push(full);
  });
  return found;
}

function scenariosTagged(tag) {
  var names = [];
  featureFiles(path.join(process.cwd(), 'features'), []).forEach(function (file) {
    var text = fs.readFileSync(file, 'utf8');
    if (!carriesTag(text, tag)) return;
    text.split('\\n').forEach(function (line) {
      var match = /^\\s*Scenario(?: Outline)?:\\s*(.+)$/.exec(line);
      if (match) names.push(match[1].trim());
    });
  });
  return names;
}

function screenshotOf(shot) {
  var image = path.join(process.env.ADW_PROOF_DIR, shot.platform, shot.screenshot);
  fs.mkdirSync(path.dirname(image), { recursive: true });
  fs.writeFileSync(image, PNG);
  return path.relative(path.dirname(process.env.ADW_JUNIT_REPORT_PATH), image);
}

function testcase(name, attachment) {
  var output = attachment === null ? '' : '<system-out><![CDATA[\\n[[ATTACHMENT|' + attachment + ']]\\n]]></system-out>';
  return '<testcase name="' + xml(name) + '" classname="gradle-stand-in" time="0.01">' + output + '</testcase>';
}

function casesOf(name) {
  if (CONFIG.screenshots.length === 0) return [testcase(name, null)];
  return CONFIG.screenshots.map(function (shot) { return testcase(name, screenshotOf(shot)); });
}

function writeReport(tag) {
  var cases = scenariosTagged(tag).reduce(function (all, name) { return all.concat(casesOf(name)); }, []);
  if (cases.length === 0) return;
  var report = '<?xml version="1.0" encoding="UTF-8"?>\\n<testsuites tests="' + cases.length + '" failures="0">' +
    '<testsuite name="gradle-stand-in" tests="' + cases.length + '" failures="0">' + cases.join('') + '</testsuite></testsuites>\\n';
  fs.mkdirSync(path.dirname(process.env.ADW_JUNIT_REPORT_PATH), { recursive: true });
  fs.writeFileSync(process.env.ADW_JUNIT_REPORT_PATH, report);
}

function writeTestClassReport(report) {
  var file = path.join(process.cwd(), report.file);
  var failure = report.status === 'failed' ? '<failure message="expected the test to pass" type="java.lang.AssertionError"/>' : '';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '<?xml version="1.0" encoding="UTF-8"?>\\n<testsuite name="' + xml(report.testClass) + '" tests="1" failures="' + (failure ? 1 : 0) + '">\\n' +
    '  <testcase name="' + xml(report.testCase) + '" classname="' + xml(report.testClass) + '" time="0.01">' + failure + '</testcase>\\n</testsuite>\\n');
}

var filter = args.filter(function (arg) { return arg.indexOf(FILTER) === 0; })[0];
var tagFilter = filter === undefined ? null : filter.slice(FILTER.length);
var testTask = args.some(function (arg, index) { return arg === TEST_TASK && args[index - 1] !== '-x'; });
fs.appendFileSync(CONFIG.callsFile, JSON.stringify({ argv: args, cwd: process.cwd(), env: adwVariables(), tagFilter: tagFilter }) + '\\n');
if (tagFilter !== null) writeReport(tagFilter);
if (testTask) CONFIG.testTask.reports.forEach(writeTestClassReport);
process.exit(testTask ? CONFIG.testTask.exitCode : 0);
`;

/** A shebang cannot carry a path with spaces; `env` finds node on PATH instead. */
function interpreterLine(): string {
  return /\s/.test(process.execPath) ? '#!/usr/bin/env node' : `#!${process.execPath}`;
}

/** Where Gradle writes the report of a test class: `TEST-<class>.xml` under the directory of its module (`:a:b` is `a/b`). */
function reportFile(report: TestClassReport): string {
  return path.join(...report.module.split(':').filter(Boolean), TEST_RESULTS_DIRECTORY, TEST_TASK, `TEST-${report.testClass}.xml`);
}

/**
 * Writes the wrapper into the root of the worktree, recording to a file in `recordDirectory`. Every scenario of a tag it is asked
 * for passes: once on each of `screenshots`' platforms, attaching the screenshot it saved there, or once with none to attach. A
 * tag that no feature file carries gets no report. Run for the `test` task, it writes the report of every test class of
 * `testTask`, whichever tasks the run excludes (Gradle leaves the results of a task it skips where an earlier run wrote them),
 * and exits with its code.
 */
export function installGradleWrapper(
  worktreePath: string,
  recordDirectory: string,
  screenshots: readonly PlatformScreenshot[],
  testTask: TestTaskRun = NO_TEST_TASK,
): GradleStandIn {
  const standIn: GradleStandIn = { callsFile: path.join(recordDirectory, 'gradle-runs.jsonl') };
  const reports = testTask.reports.map(report => ({ ...report, file: reportFile(report) }));
  const config = { screenshots, callsFile: standIn.callsFile, testTask: { reports, exitCode: testTask.exitCode } };
  fs.writeFileSync(path.join(worktreePath, 'gradlew'), `${interpreterLine()}\nvar CONFIG = ${JSON.stringify(config)};\n${WRAPPER_BODY}`, { mode: 0o755 });
  return standIn;
}

export function gradleRuns(standIn: GradleStandIn): GradleRun[] {
  if (!fs.existsSync(standIn.callsFile)) return [];
  return fs.readFileSync(standIn.callsFile, 'utf-8').split('\n').filter(Boolean).map(line => JSON.parse(line) as GradleRun);
}
