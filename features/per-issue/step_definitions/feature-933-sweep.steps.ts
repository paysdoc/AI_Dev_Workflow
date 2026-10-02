/**
 * §3 of feature-933.feature: the docs-index sweep's report issue names the default branch the code host
 * reports, and names no branch when the lookup fails.
 *
 * `runDocsIndexSweep` runs over the repository's launch boundary with every other seam injected, so it
 * prepares no worktree. The report is observed at the seam that files it.
 */

import { Before, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import { serializeConditionalDocs } from '../../../adws/core/conditionalDocsRegistry.ts';
import type { DocsIndexReportIssueSpec } from '../../../adws/core/docsIndexReportBody.ts';
import { runDocsIndexSweep } from '../../../adws/triggers/docsIndexSweep.ts';

import { ensureBoundary } from './feature-933-boundary.steps.ts';

const DOC_PATH = 'app_docs/feature-widget-pricing.md';
const FILED_ISSUE_NUMBER = 9339;

const s: { indexByRepo: Map<string, string>; filed: DocsIndexReportIssueSpec[]; completed: boolean; error: unknown } = {
  indexByRepo: new Map(),
  filed: [],
  completed: false,
  error: null,
};

Before({ tags: '@adw-933' }, function () {
  s.indexByRepo = new Map();
  s.filed = [];
  s.completed = false;
  s.error = null;
});

/** Two entries share one doc path: a `duplicate-entry` violation, which the sweep reports and never repairs. */
function indexWithDuplicateEntry(): string {
  const entry = { docPath: DOC_PATH, ownedGlobs: [], conditions: ['When changing how widgets are priced'], decisions: [] };
  return serializeConditionalDocs({ preamble: '# Conditional Documentation\n', entries: [entry, entry] });
}

function containsWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);
}

function filedReportText(): string {
  assert.strictEqual(s.filed.length, 1, 'Expected the docs-index sweep to have filed one report issue');
  return `${s.filed[0].title}\n${s.filed[0].body}`;
}

Given('the living-docs index of {string} has a violation that needs a human decision', function (repoStr: string) {
  s.indexByRepo.set(repoStr, indexWithDuplicateEntry());
});

When('the docs-index sweep runs over {string}', async function (repoStr: string) {
  const index = s.indexByRepo.get(repoStr);
  assert.ok(index, `Expected the living-docs index of ${repoStr} to have been set up first`);
  try {
    await runDocsIndexSweep({
      boundary: ensureBoundary(repoStr),
      readIndex: () => index,
      readDoc: (docPath) => (docPath === DOC_PATH ? '# Widget pricing\n' : null),
      listFiles: () => [DOC_PATH],
      persistIndex: async () => undefined,
      listReportCandidates: () => [],
      fileReport: (spec) => {
        s.filed.push(spec);
        return FILED_ISSUE_NUMBER;
      },
      refreshReport: () => undefined,
      closeReport: () => undefined,
      countBand: null,
      log: () => undefined,
    });
    s.completed = true;
  } catch (error) {
    s.error = error;
  }
});

Then('the docs-index sweep completed without an error', function () {
  assert.strictEqual(s.error, null, `Expected the docs-index sweep to complete, but it threw: ${String(s.error)}`);
  assert.ok(s.completed, 'Expected the docs-index sweep to have run');
});

Then('the docs-index sweep filed one report issue', function () {
  assert.strictEqual(s.filed.length, 1, `Expected one report issue to be filed, got ${s.filed.length}`);
});

Then('the filed docs-index report names the branch {string}', function (branch: string) {
  const text = filedReportText();
  assert.ok(containsWord(text, branch), `Expected the report to name "${branch}". Report:\n${text}`);
});

Then('the filed docs-index report names none of the branches {string}', function (branches: string) {
  const text = filedReportText();
  const named = branches.split(',').map((branch) => branch.trim()).filter((branch) => containsWord(text, branch));
  assert.deepStrictEqual(named, [], `Expected the report to name none of "${branches}", but it names ${named.join(', ')}. Report:\n${text}`);
});
