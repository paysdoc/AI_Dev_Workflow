/**
 * The source of the one program the feature-994 scenarios install as `npm`, `npx` and a scenario command: the stand-in for a
 * repository's scenario runner. Asked for a tag, it reads the script the step wrote, keeps the test cases whose scenarios carry
 * the tag (the runner's own tag filter), writes the JUnit report ADW names and the images the cases attach, and exits as the
 * script says. Plain `function`/`var` source, so that it runs under whichever Node the harness runs under with no loader.
 */

export interface RunnerProgramConfig {
  /** The JSON the program reads at every run; a step that changes what the runner reports writes it again. */
  readonly scriptFile: string;
  /** The file every run appends one JSON line to. */
  readonly callsFile: string;
  /** The text an image's bytes start with; the rest of them is the image's file name. */
  readonly bytesPrefix: string;
}

const PROGRAM_BODY = `
'use strict';
var fs = require('fs');
var path = require('path');

var tool = path.basename(process.argv[1]);
var args = process.argv.slice(2);

function record(entry) {
  fs.appendFileSync(CONFIG.callsFile, JSON.stringify(entry) + '\\n');
}

function xml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function writeFileIn(directory, name, bytes) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), bytes);
}

function imageBytes(name) {
  return Buffer.from(CONFIG.bytesPrefix + name);
}

// Playwright lists each attachment as a "[[ATTACHMENT|<path>]]" line, relative to the directory of the report.
function renderCase(testCase, position, reportDirectory, proofDirectory) {
  var directory = path.join(proofDirectory, (position + 1) + '-' + slug(testCase.name));
  var lines = testCase.attachments.map(function (file) {
    writeFileIn(directory, file, imageBytes(file));
    return '[[ATTACHMENT|' + path.relative(reportDirectory, path.join(directory, file)) + ']]';
  });
  var body = '';
  if (testCase.outcome === 'failed') body += '<failure message="the stand-in was told to fail this scenario" type="FAILURE"><![CDATA[the stand-in was told to fail this scenario]]></failure>';
  if (testCase.outcome === 'skipped') body += '<skipped/>';
  if (lines.length > 0) body += '<system-out><![CDATA[\\n' + lines.join('\\n\\n') + '\\n]]></system-out>';
  return '<testcase name="' + xml(testCase.name) + '" classname="' + xml(testCase.classname) + '" time="0.01">' + body + '</testcase>';
}

function writeReport(reportPath, proofDirectory, cases) {
  var reportDirectory = path.dirname(reportPath);
  var failures = cases.filter(function (testCase) { return testCase.outcome === 'failed'; }).length;
  var rendered = cases.map(function (testCase, position) { return renderCase(testCase, position, reportDirectory, proofDirectory); });
  var report = '<?xml version="1.0" encoding="UTF-8"?>\\n<testsuites tests="' + cases.length + '" failures="' + failures + '">' +
    '<testsuite name="stand-in" tests="' + cases.length + '" failures="' + failures + '">' + rendered.join('') + '</testsuite></testsuites>\\n';
  fs.mkdirSync(reportDirectory, { recursive: true });
  fs.writeFileSync(reportPath, report);
}

function runTag(tag) {
  var script = JSON.parse(fs.readFileSync(CONFIG.scriptFile, 'utf8'));
  record({ tool: tool, argv: args, tag: tag });
  var proofDirectory = process.env.ADW_PROOF_DIR;
  var selected = script.cases.filter(function (testCase) { return testCase.tags.indexOf('@' + tag) !== -1; });
  var failed = selected.some(function (testCase) { return testCase.outcome === 'failed'; });
  var behaviour = script.overrides['@' + tag] || { exitCode: failed ? 1 : 0, stdout: selected.length + ' scenarios', report: 'cases' };

  script.strays.forEach(function (file) { writeFileIn(proofDirectory, file, imageBytes(file)); });
  if (behaviour.report !== 'none') writeReport(process.env.ADW_JUNIT_REPORT_PATH, proofDirectory, behaviour.report === 'cases' ? selected : []);
  if (behaviour.stdout) process.stdout.write(behaviour.stdout + '\\n');
  process.exitCode = behaviour.exitCode;
}

function grepTag() {
  var at = args.indexOf('--grep');
  var value = at === -1 ? '' : String(args[at + 1] || '');
  return value.replace(/^@/, '').replace(/\\\\b$/, '');
}

function npm() {
  record({ tool: tool, argv: args });
  if (args[0] === 'ci' || args[0] === 'install') fs.mkdirSync(path.join(process.cwd(), 'node_modules'), { recursive: true });
}

function npx() {
  if (args[0] === 'playwright' && args[1] === 'test') return runTag(grepTag());
  record({ tool: tool, argv: args });
}

if (tool === 'npm') npm();
else if (tool === 'npx') npx();
else runTag(args[0]);
`;

/** A shebang cannot carry a path with spaces; `env` finds node on PATH instead. */
function interpreterLine(): string {
  return /\s/.test(process.execPath) ? '#!/usr/bin/env node' : `#!${process.execPath}`;
}

export function runnerProgramSource(config: RunnerProgramConfig): string {
  return `${interpreterLine()}\nvar CONFIG = ${JSON.stringify(config)};\n${PROGRAM_BODY}`;
}
