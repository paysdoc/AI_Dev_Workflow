/**
 * Step definitions for the stub scenarios of feature-966.feature: where the Claude CLI stub looks for
 * its marker manifest. The stub is run the way an agent runs it, in a directory of a throwaway tree,
 * with no MOCK_* name in its environment, so only a marker file can program it. The run lands in
 * feature-963's state, so its phrases judge it as they judge a run in a worktree. A bare `/` is
 * alternation in a cucumber expression, so no phrase here carries one outside a `{string}`.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';

import { REPO_ROOT } from '../../../adws/core/environment.ts';
import type { Manifest } from '../../../test/mocks/manifestSchema.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { requireStubWorktree, stateOf as stubStateOf } from './feature-963-state.ts';
import { agentArguments, finalResult, runStubIn, writePayload } from './feature-963-stubWorktree.ts';
import { stateOf, type StubLookup } from './feature-966-state.ts';

const MARKER = '.adw-stub-manifest.json';
const PLAN_PAYLOAD = join(REPO_ROOT, 'test/fixtures/jsonl/payloads/plan-agent.json');
const RESULT_LIMIT = 500;

/** Every file under `root` except git's own, relative to `base`, sorted. */
function filesUnder(root: string, base: string = root): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.name !== '.git')
    .flatMap((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? filesUnder(path, base) : [path.slice(base.length + 1)];
    })
    .sort();
}

function ancestorsOf(directory: string): string[] {
  const parent = dirname(directory);
  return parent === directory ? [directory] : [directory, ...ancestorsOf(parent)];
}

function requireLookup(world: RegressionWorld): StubLookup {
  const { stubLookup } = stateOf(world);
  assert.ok(stubLookup, 'Expected the Claude CLI stub to have been run in a directory first');
  return stubLookup;
}

/** `tree` is what the stub may write into; its files are listed first, so the Then step can name what the run added. */
function runStubInTree(world: RegressionWorld, tree: string, directory: string, command: string): void {
  const filesBefore = filesUnder(tree);
  stubStateOf(world).stubRun = runStubIn(directory, agentArguments(command, false));
  stateOf(world).stubLookup = { directory, filesBefore };
}

/** What the stub answers when no manifest programs it, for a `/feature` prompt: the plan payload's text, cut as the stub cuts it. */
function unprogrammedAnswer(): string {
  const payload = JSON.parse(readFileSync(PLAN_PAYLOAD, 'utf-8')) as Array<{ type: string; text?: string }>;
  const text = payload.filter((block) => block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('');
  return text.substring(0, RESULT_LIMIT) || 'Task completed.';
}

Given(
  'the directory {string} below that worktree holds a stub manifest whose top-level entry answers {string} and writes {string}',
  function (this: RegressionWorld, directory: string, answer: string, path: string) {
    const worktree = requireStubWorktree(this);
    const target = join(worktree.path, directory);
    mkdirSync(target, { recursive: true });
    const manifest: Manifest = {
      jsonlPath: writePayload(worktree.payloadDir, `${directory.replace(/\W+/g, '-')}.json`, answer),
      edits: [{ path, contents: `${path}, as the manifest in ${directory} writes it\n` }],
    };
    writeFileSync(join(target, MARKER), JSON.stringify(manifest), 'utf-8');
  },
);

When(
  'the Claude CLI stub is run in the directory {string} below that worktree, as an agent runs it, with a prompt that opens with {string}',
  function (this: RegressionWorld, directory: string, command: string) {
    const worktree = requireStubWorktree(this);
    const target = join(worktree.path, directory);
    mkdirSync(target, { recursive: true });
    runStubInTree(this, worktree.path, target, command);
  },
);

Then(
  'the stub wrote {string} into the directory {string} below that worktree, and no other file in that worktree',
  function (this: RegressionWorld, path: string, directory: string) {
    const worktree = requireStubWorktree(this);
    const lookup = requireLookup(this);
    assert.strictEqual(lookup.directory, join(worktree.path, directory), `Expected the stub to have been run in ${directory}`);

    const before = new Set(lookup.filesBefore);
    const added = filesUnder(worktree.path).filter((file) => !before.has(file));
    assert.deepStrictEqual(added, [join(directory, path)], `Expected the stub to have written ${path} into ${directory}, and nothing else`);
  },
);

Given(
  "a throwaway directory under the system's temporary directory, with no stub manifest in it or in any directory above it",
  function (this: RegressionWorld) {
    const directory = mkdtempSync(join(tmpdir(), 'adw-966-bare-'));
    this.cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const markers = ancestorsOf(resolve(directory)).map((ancestor) => join(ancestor, MARKER)).filter((marker) => existsSync(marker));
    assert.deepStrictEqual(markers, [], `Expected no stub manifest in ${directory} or above it`);
    stateOf(this).bareDirectory = directory;
  },
);

When(
  'the Claude CLI stub is run in that directory, as an agent runs it, with a prompt that opens with {string}',
  function (this: RegressionWorld, command: string) {
    const { bareDirectory } = stateOf(this);
    assert.ok(bareDirectory, 'Expected a throwaway directory without a stub manifest first');
    runStubInTree(this, bareDirectory, bareDirectory, command);
  },
);

Then('the stub exits 0 with the answer it gives when no manifest programs it', function (this: RegressionWorld) {
  const { stubRun } = stubStateOf(this);
  assert.ok(stubRun, 'Expected the Claude CLI stub to have been run first');
  assert.strictEqual(stubRun.status, 0, `Expected the stub to exit 0, but it exited ${stubRun.status}.\nstderr:\n${stubRun.stderr}`);
  assert.strictEqual(finalResult(stubRun)['result'], unprogrammedAnswer());
});

Then('the stub wrote no file into that directory', function (this: RegressionWorld) {
  const { directory } = requireLookup(this);
  assert.deepStrictEqual(readdirSync(directory), [], `Expected the stub to have written nothing into ${directory}`);
});
