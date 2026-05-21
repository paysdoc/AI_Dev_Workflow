/**
 * BDD step definitions for feature-507.feature
 * vocabulary.md.template + adwInit copies it + writes per-issue/regression dir flags
 *
 * Design decisions:
 *  - Target repos are created as temp directories; all assertions read artefact
 *    files written by applyManifest (the stub), never framework source files.
 *  - The "adwInit agent run" is simulated by calling applyManifest directly
 *    against the target repo dir, mirroring what the claude-cli-stub would do.
 *  - Shared targetRepos state is imported from feature-506.steps.ts so that
 *    existing Then steps (e.g. "artefact file at {string} exists in target
 *    repo {string}") can find repos created by feature-507 Given steps.
 *  - Step texts containing "/" use regex patterns because "/" is the alternation
 *    operator in Cucumber Expressions (cucumber-js 12.x).
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyManifest } from '../../../test/mocks/manifestInterpreter.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { targetRepos } from './feature-506.steps.ts';

// ---------------------------------------------------------------------------
// Module-level state — reset in Before hook per @adw-507 scenario
// ---------------------------------------------------------------------------

interface AdwInitRunResult {
  exitCode: number;
  writtenPaths: string[];
  targetRepoDir: string;
}

const adwInitRunData = new Map<string, AdwInitRunResult>();

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-507
// ---------------------------------------------------------------------------

Before({ tags: '@adw-507' }, function () {
  for (const dir of targetRepos.values()) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  targetRepos.clear();
  adwInitRunData.clear();
});

After({ tags: '@adw-507' }, function () {
  for (const dir of targetRepos.values()) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Given — fresh target repo setup
// Regex patterns are used for step texts containing "/" (alternation operator
// in Cucumber Expressions) and ".md" (to be safe with dot matching).
// "fresh" prefix distinguishes these from feature-506's "a target repo" steps.
// ---------------------------------------------------------------------------

Given(
  /^a fresh target repo "([^"]+)" with no features\/regression\/vocabulary\.md$/,
  function (repoName: string) {
    ensureTargetRepo507(repoName);
    // vocabulary.md intentionally absent — repo exists without it
  },
);

Given(
  /^a fresh target repo "([^"]+)" with no \.adw\/scenarios\.md$/,
  function (repoName: string) {
    ensureTargetRepo507(repoName);
    // .adw/scenarios.md intentionally absent — repo exists without it
  },
);

// ---------------------------------------------------------------------------
// When — adwInit agent invocation (simulated via applyManifest)
// ---------------------------------------------------------------------------

When(
  'the adwInit agent is invoked in target repo {string} with adwId {string} for issue {int}',
  function (this: RegressionWorld, repoName: string, adwId: string, _issueNumber: number) {
    const dir = targetRepos.get(repoName);
    assert.ok(
      dir,
      `Target repo "${repoName}" not found — ensure it is created by a Given step`,
    );

    const manifestPath = this.harnessEnv['MOCK_MANIFEST_PATH'];
    assert.ok(
      manifestPath,
      'MOCK_MANIFEST_PATH not set — use "the claude-cli-stub is loaded with manifest" step',
    );

    const result = applyManifest(manifestPath, dir);

    adwInitRunData.set(adwId, {
      exitCode: 0,
      writtenPaths: result.editsApplied,
      targetRepoDir: dir,
    });
  },
);

// ---------------------------------------------------------------------------
// Then — vocabulary.md content assertions
// ---------------------------------------------------------------------------

Then(
  'the artefact file at {string} in target repo {string} contains a {string} section heading',
  function (relPath: string, repoName: string, headingText: string) {
    const content = readArtefactFile507(relPath, repoName);
    const found = content
      .split('\n')
      .some((line) => line.startsWith('#') && line.includes(headingText));
    assert.ok(
      found,
      `Expected "${relPath}" in "${repoName}" to contain section heading "${headingText}"`,
    );
  },
);

Then(
  'the artefact file at {string} in target repo {string} contains an observability-surfaces examples placeholder marker',
  function (relPath: string, repoName: string) {
    const content = readArtefactFile507(relPath, repoName);
    const hasMarker =
      content.includes('<!-- TODO') || content.includes('## Observability Surfaces');
    assert.ok(
      hasMarker,
      `Expected "${relPath}" in "${repoName}" to contain an observability-surfaces examples placeholder marker`,
    );
  },
);

Then(
  'the artefact file at {string} in target repo {string} registers at least one seed phrase under the Given heading',
  function (relPath: string, repoName: string) {
    assertSeedPhrasesUnderHeading(relPath, repoName, 'Given');
  },
);

Then(
  'the artefact file at {string} in target repo {string} registers at least one seed phrase under the When heading',
  function (relPath: string, repoName: string) {
    assertSeedPhrasesUnderHeading(relPath, repoName, 'When');
  },
);

Then(
  'the artefact file at {string} in target repo {string} registers at least one seed phrase under the Then heading',
  function (relPath: string, repoName: string) {
    assertSeedPhrasesUnderHeading(relPath, repoName, 'Then');
  },
);

// ---------------------------------------------------------------------------
// Then — .adw/scenarios.md polymorphism flag assertions
// ---------------------------------------------------------------------------

Then(
  'the Per-Issue Scenario Directory value in target repo {string} is non-empty',
  function (repoName: string) {
    assertPolymorphismFlag(repoName, 'Per-Issue Scenario Directory');
  },
);

Then(
  'the Regression Scenario Directory value in target repo {string} is non-empty',
  function (repoName: string) {
    assertPolymorphismFlag(repoName, 'Regression Scenario Directory');
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureTargetRepo507(repoName: string): void {
  if (!targetRepos.has(repoName)) {
    const safe = repoName.replace(/[^a-z0-9]/gi, '-');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `adw-init-507-${safe}-`));
    targetRepos.set(repoName, dir);
  }
}

function readArtefactFile507(relPath: string, repoName: string): string {
  const dir = targetRepos.get(repoName);
  assert.ok(dir, `Target repo "${repoName}" not found`);
  const absPath = path.join(dir, relPath);
  assert.ok(
    fs.existsSync(absPath),
    `Expected artefact file at "${absPath}" but it does not exist`,
  );
  return fs.readFileSync(absPath, 'utf-8');
}

function assertSeedPhrasesUnderHeading(
  relPath: string,
  repoName: string,
  heading: string,
): void {
  const content = readArtefactFile507(relPath, repoName);
  const lines = content.split('\n');
  let inSection = false;
  let nonSeparatorTableRows = 0;

  for (const line of lines) {
    if (line.startsWith('#') && line.includes(`## ${heading}`)) {
      inSection = true;
      nonSeparatorTableRows = 0;
      continue;
    }
    if (inSection) {
      if (line.startsWith('##')) break;
      if (line.startsWith('|')) {
        // Skip separator rows (all dashes, colons, pipes, spaces)
        if (!/^\|[-:\s|]+\|$/.test(line)) {
          nonSeparatorTableRows++;
        }
      }
    }
  }

  // Require header row + at least one data row = at least 2 non-separator rows
  assert.ok(
    nonSeparatorTableRows >= 2,
    `Expected "${relPath}" to register at least one seed phrase under ## ${heading} ` +
      `(found ${nonSeparatorTableRows} non-separator table rows, need ≥2: header + one data row)`,
  );
}

function assertPolymorphismFlag(repoName: string, sectionName: string): void {
  const dir = targetRepos.get(repoName);
  assert.ok(dir, `Target repo "${repoName}" not found`);
  const scenPath = path.join(dir, '.adw', 'scenarios.md');
  assert.ok(
    fs.existsSync(scenPath),
    `Expected .adw/scenarios.md to exist in target repo "${repoName}"`,
  );
  const content = fs.readFileSync(scenPath, 'utf-8');

  const headingMarker = `## ${sectionName}`;
  const headingIdx = content.indexOf(headingMarker);
  assert.ok(
    headingIdx >= 0,
    `Expected .adw/scenarios.md to contain "${headingMarker}" section`,
  );

  const afterHeading = content.slice(headingIdx + headingMarker.length);
  const nextHeadingIdx = afterHeading.indexOf('\n## ');
  const sectionBody =
    nextHeadingIdx >= 0 ? afterHeading.slice(0, nextHeadingIdx) : afterHeading;

  const valueLines = sectionBody
    .split('\n')
    .filter((l) => l.trim().length > 0 && !l.trim().startsWith('<!--'));

  assert.ok(
    valueLines.length > 0,
    `Expected "${headingMarker}" to have a non-empty value in .adw/scenarios.md`,
  );
}
