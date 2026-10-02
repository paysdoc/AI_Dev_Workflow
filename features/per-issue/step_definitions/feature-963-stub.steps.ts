/**
 * Step definitions for the Claude CLI stub scenarios of feature-963.feature: a throwaway git
 * worktree holding a marker manifest, the stub run the way an agent runs it, and what the stub
 * answered and wrote. A bare `/` is alternation in a cucumber expression, so every phrase that
 * names a slash command is a regular expression.
 */

import { DataTable, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync } from 'fs';
import { join } from 'path';

import type { Manifest, ManifestCommandEntry } from '../../../test/mocks/manifestSchema.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { requireStubWorktree, stateOf, type StubRun, type StubWorktree } from './feature-963-state.ts';
import { agentArguments, declaredEditPaths, finalResult, flushManifest, makeStubWorktree, runStubAsAgent, writePayload } from './feature-963-stubWorktree.ts';

const DEFAULT_ANSWER = 'the default answer';

type EntryName = 'top-level entry' | '/feature entry' | '/commit entry';

const ENTRY_COMMANDS: Record<Exclude<EntryName, 'top-level entry'>, string> = {
  '/feature entry': '/feature',
  '/commit entry': '/commit',
};

function requireRun(world: RegressionWorld): StubRun {
  const { stubRun } = stateOf(world);
  assert.ok(stubRun, 'Expected the Claude CLI stub to have been run first');
  return stubRun;
}

function editWriting(path: string): { path: string; contents: string } {
  return { path, contents: `${path}, as the manifest writes it\n` };
}

function payloadName(command: string): string {
  return `${command.replace(/^\//, '')}.json`;
}

function addEntry(worktree: StubWorktree, command: string, entry: ManifestCommandEntry): void {
  worktree.manifest.byCommand = { ...worktree.manifest.byCommand, [command]: entry };
}

function ownEntryFor(worktree: StubWorktree, command: string): ManifestCommandEntry {
  return worktree.manifest.byCommand?.[command] ?? { jsonlPath: writePayload(worktree.payloadDir, payloadName(command), `the ${command} answer`) };
}

function defaultManifest(payloadDir: string): Manifest {
  return { jsonlPath: writePayload(payloadDir, 'default.json', DEFAULT_ANSWER), edits: [] };
}

Given(
  'a throwaway git worktree holding a stub manifest whose top-level entry answers {string} and writes {string}',
  function (this: RegressionWorld, answer: string, path: string) {
    stateOf(this).stubWorktree = makeStubWorktree(this, (payloadDir) => ({
      jsonlPath: writePayload(payloadDir, 'default.json', answer),
      edits: [editWriting(path)],
    }));
  },
);

Given('the stub manifest also has these per-command entries:', function (this: RegressionWorld, table: DataTable) {
  const worktree = requireStubWorktree(this);
  for (const { command, answer, writes } of table.hashes()) {
    addEntry(worktree, command, { jsonlPath: writePayload(worktree.payloadDir, payloadName(command), answer), edits: [editWriting(writes)] });
  }
  flushManifest(worktree);
});

Given(
  /^a throwaway git worktree holding a stub manifest whose (top-level entry|\/feature entry) answers with the error response$/,
  function (this: RegressionWorld, entry: 'top-level entry' | '/feature entry') {
    const worktree = makeStubWorktree(this, defaultManifest);
    if (entry === 'top-level entry') {
      worktree.manifest.response = { kind: 'error' };
    } else {
      addEntry(worktree, '/feature', { jsonlPath: worktree.manifest.jsonlPath, response: { kind: 'error' } });
    }
    flushManifest(worktree);
    stateOf(this).stubWorktree = worktree;
  },
);

Given(
  /^the stub manifest's (top-level entry|\/feature entry|\/commit entry) also writes "([^"]*)"$/,
  function (this: RegressionWorld, entry: EntryName, path: string) {
    const worktree = requireStubWorktree(this);
    if (entry === 'top-level entry') {
      worktree.manifest.edits.push(editWriting(path));
    } else {
      const command = ENTRY_COMMANDS[entry];
      const own = ownEntryFor(worktree, command);
      addEntry(worktree, command, { ...own, edits: [...(own.edits ?? []), editWriting(path)] });
    }
    flushManifest(worktree);
  },
);

When(
  'the Claude CLI stub is run in that worktree, as an agent runs it, with a prompt that opens with {string}',
  function (this: RegressionWorld, command: string) {
    stateOf(this).stubRun = runStubAsAgent(requireStubWorktree(this), agentArguments(command, false));
  },
);

When(
  'the Claude CLI stub is run in that worktree with the arguments an agent passes for a target repository whose guardrails are injected, ending in a prompt that opens with {string}',
  function (this: RegressionWorld, command: string) {
    stateOf(this).stubRun = runStubAsAgent(requireStubWorktree(this), agentArguments(command, true));
  },
);

Then('the stub exits 0 with the result {string}', function (this: RegressionWorld, answer: string) {
  const run = requireRun(this);
  assert.strictEqual(run.status, 0, `Expected the stub to exit 0, but it exited ${run.status}.\nstderr:\n${run.stderr}`);
  assert.strictEqual(finalResult(run)['result'], answer);
});

Then('the stub exits 1', function (this: RegressionWorld) {
  const run = requireRun(this);
  assert.strictEqual(run.status, 1, `Expected the stub to exit 1, but it exited ${run.status}.\nstderr:\n${run.stderr}`);
});

Then('the stub exits 1 with an error that names {string}', function (this: RegressionWorld, path: string) {
  const run = requireRun(this);
  assert.strictEqual(run.status, 1, `Expected the stub to exit 1, but it exited ${run.status}.\nstderr:\n${run.stderr}`);
  assert.ok(run.stderr.includes(path), `Expected the stub's error to name ${path}, but its stderr reads:\n${run.stderr}`);
});

Then("the stub's output ends with a result whose is_error is true", function (this: RegressionWorld) {
  assert.strictEqual(finalResult(requireRun(this))['is_error'], true);
});

function written(worktree: StubWorktree, paths: readonly string[]): string[] {
  return paths.filter((path) => existsSync(join(worktree.path, path)));
}

Then('the stub wrote {string} into the worktree', function (this: RegressionWorld, path: string) {
  assert.deepStrictEqual(written(requireStubWorktree(this), [path]), [path], `Expected the stub to have written ${path} into the worktree`);
});

Then(
  "the stub wrote {string} into the worktree, and none of the files the manifest's other entries write",
  function (this: RegressionWorld, path: string) {
    const worktree = requireStubWorktree(this);
    const others = declaredEditPaths(worktree.manifest).filter((declared) => declared !== path);

    assert.deepStrictEqual(written(worktree, [path]), [path], `Expected the stub to have written ${path} into the worktree`);
    assert.deepStrictEqual(written(worktree, others), [], `Expected the stub to have written none of the files its other entries write: ${others.join(', ')}`);
  },
);

Then("the stub wrote none of the manifest's edits into the worktree", function (this: RegressionWorld) {
  const worktree = requireStubWorktree(this);
  assert.deepStrictEqual(written(worktree, declaredEditPaths(worktree.manifest)), [], 'Expected the stub to have written none of the manifest\'s edits');
});
