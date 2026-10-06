/**
 * The source of the throwaway programs the feature-992 scenarios put where ADW looks for the real ones: `npm`, `npx`, a
 * scenario command, and a dev server. Plain `function`/`var` source, so that the programs run under whichever Node the
 * harness runs under with no loader. Every absolute path and every behaviour is baked into a program when it is written,
 * because the environment ADW hands a program is ADW's own and carries nothing of the harness.
 */

export interface ToolConfig {
  /** The file every run of `npm`, `npx` or the scenario command appends one JSON line to. */
  readonly callsFile: string;
  /** Tags (without the `@`) whose JUnit report carries one failing scenario. */
  readonly failingTags: readonly string[];
  /** What `npx playwright test` exits with, whatever its report says. */
  readonly playwrightExitCode: number;
  /** The path `npx playwright test` asks the dev server for, before and after it holds. */
  readonly probePath: string;
  readonly holdMs: number;
}

export interface DevServerConfig {
  readonly title: string;
  readonly healthPath: string;
  readonly healthStatus: number;
}

const TOOL_BODY = `
'use strict';
var fs = require('fs');
var http = require('http');
var path = require('path');

var tool = path.basename(process.argv[1]);
var args = process.argv.slice(2);

var PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function adwVariables() {
  var found = {};
  Object.keys(process.env).forEach(function (name) {
    if (name.indexOf('ADW_') === 0) found[name] = process.env[name];
  });
  return found;
}

function packagesNamedIn(dir) {
  try {
    var manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return Object.keys(Object.assign({}, manifest.dependencies, manifest.devDependencies));
  } catch (error) {
    return [];
  }
}

function record(extra) {
  var entry = Object.assign({ tool: tool, argv: args, cwd: process.cwd(), env: adwVariables(), packages: packagesNamedIn(process.cwd()) }, extra);
  fs.appendFileSync(CONFIG.callsFile, JSON.stringify(entry) + '\\n');
}

function xml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function carriesTag(text, tag) {
  var needle = '@' + tag;
  var from = 0;
  for (;;) {
    var at = text.indexOf(needle, from);
    if (at === -1) return false;
    if (!/[A-Za-z0-9_-]/.test(text.charAt(at + needle.length))) return true;
    from = at + 1;
  }
}

function featureFiles(dir, found) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (entry.name === 'node_modules' || entry.name.charAt(0) === '.') return;
    var full = path.join(dir, entry.name);
    if (entry.isDirectory()) featureFiles(full, found);
    else if (entry.name.slice(-8) === '.feature') found.push(full);
  });
  return found;
}

function scenarioNameOf(line) {
  var trimmed = line.trim();
  var prefixes = ['Scenario Outline:', 'Scenario:'];
  for (var i = 0; i < prefixes.length; i++) {
    if (trimmed.indexOf(prefixes[i]) === 0) return trimmed.slice(prefixes[i].length).trim();
  }
  return null;
}

function scenariosTagged(tag) {
  var names = [];
  featureFiles(process.cwd(), []).forEach(function (file) {
    var text = fs.readFileSync(file, 'utf8');
    if (!carriesTag(text, tag)) return;
    text.split('\\n').forEach(function (line) {
      var name = scenarioNameOf(line);
      if (name) names.push(name);
    });
  });
  return names.length > 0 ? names : ['A scenario tagged @' + tag];
}

function writeReport(reportPath, proofDir, tag) {
  var failing = CONFIG.failingTags.indexOf(tag) !== -1;
  var cases = scenariosTagged(tag).map(function (name, index) {
    var failure = failing && index === 0 ? '<failure message="the stand-in was told to fail this scenario"/>' : '';
    var attachment = '';
    if (index === 0 && proofDir) {
      var image = path.join(proofDir, 'scenario-1', 'test-finished-1.png');
      fs.mkdirSync(path.dirname(image), { recursive: true });
      fs.writeFileSync(image, PNG);
      attachment = '<system-out><![CDATA[\\n[[ATTACHMENT|' + path.relative(path.dirname(reportPath), image) + ']]\\n]]></system-out>';
    }
    return '<testcase name="' + xml(name) + '" classname="stand-in.feature" time="0.01">' + failure + attachment + '</testcase>';
  });
  var failures = failing ? 1 : 0;
  var report = '<?xml version="1.0" encoding="UTF-8"?>\\n<testsuites tests="' + cases.length + '" failures="' + failures + '">' +
    '<testsuite name="stand-in" tests="' + cases.length + '" failures="' + failures + '">' + cases.join('') + '</testsuite></testsuites>\\n';
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report);
}

function writeLockfile() {
  var manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  var lock = { name: manifest.name, lockfileVersion: 3, requires: true, packages: { '': { name: manifest.name, devDependencies: manifest.devDependencies } } };
  fs.writeFileSync(path.join(process.cwd(), 'package-lock.json'), JSON.stringify(lock, null, 2) + '\\n');
}

function installPackages() {
  var nodeModules = path.join(process.cwd(), 'node_modules');
  fs.mkdirSync(nodeModules, { recursive: true });
  packagesNamedIn(process.cwd()).forEach(function (name) {
    var dir = path.join(nodeModules, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: name, version: '0.0.0-stand-in' }) + '\\n');
  });
}

function npm() {
  var subcommand = args[0];
  record({});
  if (subcommand === 'ci' && !fs.existsSync(path.join(process.cwd(), 'package-lock.json'))) {
    process.stderr.write('npm error The \\u0060npm ci\\u0060 command can only install with an existing package-lock.json\\n');
    process.exit(1);
  }
  if (subcommand === 'ci' || subcommand === 'install') installPackages();
  if (subcommand === 'install' && fs.existsSync(path.join(process.cwd(), 'package.json'))) writeLockfile();
  process.exit(0);
}

function grepTag() {
  var at = args.indexOf('--grep');
  var value = at === -1 ? '' : String(args[at + 1] || '');
  return value.replace(/^@/, '').replace(/\\\\b$/, '');
}

function probe(phase, probes, done) {
  var url = process.env.ADW_APPLICATION_URL;
  if (!url) return done();
  http.get(url + CONFIG.probePath, function (response) {
    response.resume();
    probes.push({ phase: phase, status: response.statusCode });
    done();
  }).on('error', function () {
    probes.push({ phase: phase, status: null });
    done();
  });
}

function playwrightTest() {
  var tag = grepTag();
  var probes = [];
  probe('start', probes, function () {
    setTimeout(function () {
      writeReport(process.env.ADW_JUNIT_REPORT_PATH, process.env.ADW_PROOF_DIR, tag);
      probe('end', probes, function () {
        record({ tag: tag, probes: probes });
        process.exit(CONFIG.playwrightExitCode);
      });
    }, CONFIG.holdMs);
  });
}

function npx() {
  if (args[0] === 'playwright' && args[1] === 'test') return playwrightTest();
  record({});
  var known = args[0] === 'bddgen' || (args[0] === 'playwright' && args[1] === 'install');
  if (!known) process.stderr.write('stand-in npx: no behaviour for: ' + args.join(' ') + '\\n');
  process.exit(0);
}

function scenarioCommand() {
  record({ tag: args[0] });
  writeReport(process.env.ADW_JUNIT_REPORT_PATH, process.env.ADW_PROOF_DIR, args[0]);
  process.exit(0);
}

if (tool === 'npm') npm();
else if (tool === 'npx') npx();
else scenarioCommand();
`;

const DEV_SERVER_BODY = `
'use strict';
var fs = require('fs');
var http = require('http');

var port = Number(process.argv[2]);
var logFile = process.argv[3];

function log(line) {
  fs.appendFileSync(logFile, line + '\\n');
}

var server = http.createServer(function (request, response) {
  log('GET ' + request.url);
  if (request.url === CONFIG.healthPath) {
    response.writeHead(CONFIG.healthStatus, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><html><head><title>' + CONFIG.title + '</title></head><body><h1>' + CONFIG.title + '</h1></body></html>');
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

server.listen(port, function () {
  log('listening ' + port);
});
process.on('SIGTERM', function () {
  log('stopped');
  process.exit(0);
});
`;

/** A shebang cannot carry a path with spaces; `env` finds node on PATH instead. */
function interpreterLine(): string {
  return /\s/.test(process.execPath) ? '#!/usr/bin/env node' : `#!${process.execPath}`;
}

export function toolSource(config: ToolConfig): string {
  return `${interpreterLine()}\nvar CONFIG = ${JSON.stringify(config)};\n${TOOL_BODY}`;
}

export function devServerSource(config: DevServerConfig): string {
  return `var CONFIG = ${JSON.stringify(config)};\n${DEV_SERVER_BODY}`;
}
