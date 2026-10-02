/**
 * The regression-suite scenario of feature-934.feature. It runs Cucumber itself in a dry run over a
 * child process and reads the run's message stream: which scenarios are listed under the given
 * directory, the tags they carry, and which scenario hooks the dry run attaches to which test case.
 * `cucumber.js` also configures the per-issue paths, so the listing keeps only the scenarios whose
 * file lies under the directory. A scenario hook is a BEFORE_TEST_CASE or AFTER_TEST_CASE hook.
 */

import { Then, When } from '@cucumber/cucumber';
import type { DataTable } from '@cucumber/cucumber';
import type { Envelope, Hook, Pickle, TestCase } from '@cucumber/messages';
import assert from 'assert';
import { spawnSync } from 'child_process';

const SCENARIO_HOOK_TYPES: ReadonlySet<string> = new Set(['BEFORE_TEST_CASE', 'AFTER_TEST_CASE']);

interface Listing {
  readonly pickles: readonly Pickle[];
  readonly testCases: readonly TestCase[];
  /** Scenario hooks whose definition lies under the listed directory. */
  readonly hooks: readonly Hook[];
}

const state: { listing: Listing | null } = { listing: null };

function requireListing(): Listing {
  assert.ok(state.listing, 'Expected Cucumber to have listed the scenarios in a dry run first');
  return state.listing;
}

function parseEnvelopes(output: string): Envelope[] {
  return output.split('\n').filter(line => line.trim().length > 0).map(line => JSON.parse(line) as Envelope);
}

function listingFrom(envelopes: readonly Envelope[], directory: string): Listing {
  const pickles = envelopes.flatMap(envelope => (envelope.pickle?.uri.startsWith(directory) ? [envelope.pickle] : []));
  const listedIds = new Set(pickles.map(pickle => pickle.id));
  return {
    pickles,
    testCases: envelopes.flatMap(envelope => (envelope.testCase && listedIds.has(envelope.testCase.pickleId) ? [envelope.testCase] : [])),
    hooks: envelopes.flatMap(envelope => {
      const hook = envelope.hook;
      const defined = hook?.sourceReference.uri?.startsWith(directory) ?? false;
      return hook && defined && SCENARIO_HOOK_TYPES.has(hook.type ?? '') ? [hook] : [];
    }),
  };
}

function tagNames(pickle: Pickle): string[] {
  return pickle.tags.map(tag => tag.name);
}

function describeHook(hook: Hook): string {
  return `${hook.type} "${hook.tagExpression ?? ''}" at ${hook.sourceReference.uri}:${hook.sourceReference.location?.line}`;
}

When('Cucumber lists the scenarios under {string} in a dry run', function (directory: string) {
  const result = spawnSync('bunx', ['cucumber-js', '--dry-run', '--format', 'message', directory], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: '--import tsx' },
  });
  assert.strictEqual(result.status, 0, `Expected the dry run to succeed. stderr:\n${result.stderr}`);
  state.listing = listingFrom(parseEnvelopes(result.stdout), directory);
  assert.ok(state.listing.pickles.length > 0, `Expected the dry run to list scenarios under ${directory}`);
});

Then('none of the listed scenarios carries a tag starting with {string}', function (prefix: string) {
  const offenders = requireListing().pickles.filter(pickle => tagNames(pickle).some(tag => tag.startsWith(prefix)));
  assert.deepStrictEqual(
    offenders.map(pickle => `${pickle.uri}: ${pickle.name} [${tagNames(pickle).filter(tag => tag.startsWith(prefix)).join(' ')}]`),
    [],
    `Expected no listed scenario to carry a "${prefix}" tag`,
  );
});

Then('every listed scenario carries the tag {string}', function (tag: string) {
  const missing = requireListing().pickles.filter(pickle => !tagNames(pickle).includes(tag));
  assert.deepStrictEqual(missing.map(pickle => `${pickle.uri}: ${pickle.name}`), [], `Expected every listed scenario to carry ${tag}`);
});

Then('the listing still holds scenarios from each of these files:', function (table: DataTable) {
  const listedFiles = new Set(requireListing().pickles.map(pickle => pickle.uri));
  const missing = table.hashes().map(row => row.file).filter(file => !listedFiles.has(file));
  assert.deepStrictEqual(missing, [], 'Expected the listing to still hold scenarios from every named file');
});

Then('every scenario hook defined under {string} applies to at least one listed scenario', function (directory: string) {
  const { testCases, hooks } = requireListing();
  assert.ok(hooks.length > 0, `Expected scenario hooks to be defined under ${directory}`);
  const attached = new Set(testCases.flatMap(testCase => testCase.testSteps.flatMap(step => (step.hookId ? [step.hookId] : []))));
  const dead = hooks.filter(hook => !attached.has(hook.id));
  assert.deepStrictEqual(dead.map(describeHook), [], 'Expected every scenario hook to apply to at least one listed scenario');
});
