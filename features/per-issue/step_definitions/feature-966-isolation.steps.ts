/**
 * Step definitions for the isolation scenario of feature-966.feature: the subprocess rows run in a
 * Cucumber process of its own whose `HOME` is a throwaway directory and whose `PATH` leads with a
 * `gh` that records every call it receives, standing in for the developer's own. The run is
 * feature-961's step, which reads the environment these Givens set. A process the harness starts
 * must reach neither: the `gh` shadow leads its `PATH`, and its `HOME` is another throwaway directory.
 */

import { Given, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { stateOf } from './feature-966-state.ts';
import { setChildEnvironment } from './feature-961.steps.ts';

const CLAUDE_JSON = '.claude.json';

function throwawayDirectory(world: RegressionWorld, prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  world.cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** What the child Cucumber process is given on top of the parent's environment; each Given adds its part. */
function giveChild(world: RegressionWorld, overlay: Record<string, string>): void {
  const state = stateOf(world);
  state.childEnvironment = { ...state.childEnvironment, ...overlay };
  setChildEnvironment(state.childEnvironment);
}

function requireDeveloper(world: RegressionWorld): { homeDirectory: string; claudeJson: string } {
  const { developer } = stateOf(world);
  assert.ok(developer, "Expected the developer's HOME to have been set up first");
  return developer;
}

Given("the developer's HOME is a throwaway directory holding a \".claude.json\" file", function (this: RegressionWorld) {
  const homeDirectory = throwawayDirectory(this, 'adw-966-home-');
  const claudeJson = JSON.stringify({ projects: { '/the/developers/own/checkout': { hasTrustDialogAccepted: true } } });
  writeFileSync(join(homeDirectory, CLAUDE_JSON), claudeJson, 'utf-8');
  stateOf(this).developer = { homeDirectory, claudeJson };
  giveChild(this, { HOME: homeDirectory });
});

Given("the developer's gh, first on the PATH, records every call it receives", function (this: RegressionWorld) {
  const directory = throwawayDirectory(this, 'adw-966-dev-gh-');
  const binDir = join(directory, 'bin');
  mkdirSync(binDir);
  const logPath = join(directory, 'calls.log');
  // It records and refuses, so a call that reached it can neither go unnoticed nor be taken for an answer.
  writeFileSync(join(binDir, 'gh'), ['#!/bin/sh', `printf '%s\\n' "$*" >> '${logPath}'`, "echo \"the developer's gh was called\" >&2", 'exit 1', ''].join('\n'), 'utf-8');
  chmodSync(join(binDir, 'gh'), 0o755);
  stateOf(this).developerGhLog = logPath;
  giveChild(this, { PATH: `${binDir}${delimiter}${process.env['PATH'] ?? ''}` });
});

Then("the developer's gh received no call", function (this: RegressionWorld) {
  const { developerGhLog } = stateOf(this);
  assert.ok(developerGhLog, "Expected the developer's gh to have been set up first");
  const calls = existsSync(developerGhLog) ? readFileSync(developerGhLog, 'utf-8') : '';
  assert.strictEqual(calls, '', `Expected the developer's gh to receive no call, but it received:\n${calls}`);
});

Then("the developer's \".claude.json\" file is as it was before that run", function (this: RegressionWorld) {
  const { homeDirectory, claudeJson } = requireDeveloper(this);
  assert.strictEqual(readFileSync(join(homeDirectory, CLAUDE_JSON), 'utf-8'), claudeJson);
});

Then("the developer's HOME holds no \".adw\" directory", function (this: RegressionWorld) {
  const { homeDirectory } = requireDeveloper(this);
  assert.ok(!existsSync(join(homeDirectory, '.adw')), `Expected ${homeDirectory} to hold no .adw directory`);
});
