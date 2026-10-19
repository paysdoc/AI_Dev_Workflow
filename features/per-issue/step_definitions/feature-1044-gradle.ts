/**
 * The Gradle wrapper of a feature-1044 worktree: a stand-in for `./gradlew` that the scenario command of a "mobile:kotlincm"
 * repository finds in the worktree's root. Each run appends what it was given (arguments, working directory, the `ADW_`
 * variables and the cucumber tag filter) to one file, which the scenarios read back, and writes the JUnit report of the tag it
 * was asked for. Plain `function`/`var` source: it runs under whichever Node the harness runs under, with no loader.
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

const TAG_FILTER_PROPERTY = '-Dcucumber.filter.tags=';

const WRAPPER_BODY = `
'use strict';
var fs = require('fs');
var path = require('path');

var args = process.argv.slice(2);
var FILTER = ${JSON.stringify(TAG_FILTER_PROPERTY)};
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

var filter = args.filter(function (arg) { return arg.indexOf(FILTER) === 0; })[0];
var tagFilter = filter === undefined ? null : filter.slice(FILTER.length);
fs.appendFileSync(CONFIG.callsFile, JSON.stringify({ argv: args, cwd: process.cwd(), env: adwVariables(), tagFilter: tagFilter }) + '\\n');
if (tagFilter !== null) writeReport(tagFilter);
process.exit(0);
`;

/** A shebang cannot carry a path with spaces; `env` finds node on PATH instead. */
function interpreterLine(): string {
  return /\s/.test(process.execPath) ? '#!/usr/bin/env node' : `#!${process.execPath}`;
}

/**
 * Writes the wrapper into the root of the worktree, recording to a file in `recordDirectory`. Every scenario of a tag it is asked
 * for passes: once on each of `screenshots`' platforms, attaching the screenshot it saved there, or once with none to attach. A
 * tag that no feature file carries gets no report.
 */
export function installGradleWrapper(worktreePath: string, recordDirectory: string, screenshots: readonly PlatformScreenshot[]): GradleStandIn {
  const standIn: GradleStandIn = { callsFile: path.join(recordDirectory, 'gradle-runs.jsonl') };
  const config = { screenshots, callsFile: standIn.callsFile };
  fs.writeFileSync(path.join(worktreePath, 'gradlew'), `${interpreterLine()}\nvar CONFIG = ${JSON.stringify(config)};\n${WRAPPER_BODY}`, { mode: 0o755 });
  return standIn;
}

export function gradleRuns(standIn: GradleStandIn): GradleRun[] {
  if (!fs.existsSync(standIn.callsFile)) return [];
  return fs.readFileSync(standIn.callsFile, 'utf-8').split('\n').filter(Boolean).map(line => JSON.parse(line) as GradleRun);
}
