/**
 * BDD step definitions for feature-508.feature
 * LLM-drafted observability-surfaces examples block in adwInit
 *
 * Design decisions:
 *  - Target repos are created as temp directories; all assertions read artefact
 *    files written by applyManifest (the stub), never framework source files.
 *  - The "adwInit agent run" is simulated by calling applyManifest directly
 *    against the target repo dir, mirroring what the claude-cli-stub would do.
 *  - Shared targetRepos state is imported from feature-506.steps.ts so that
 *    existing Then steps (e.g. "artefact file at {string} exists in target
 *    repo {string}") can find repos created by feature-508 Given steps.
 *  - Step texts containing "/" use regex patterns because "/" is the alternation
 *    operator in Cucumber Expressions (cucumber-js 12.x).
 */

import { Given, Before, After, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { targetRepos } from './feature-506.steps.ts';

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-508
// ---------------------------------------------------------------------------

Before({ tags: '@adw-508' }, function () {
  for (const dir of targetRepos.values()) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  targetRepos.clear();
});

After({ tags: '@adw-508' }, function () {
  for (const dir of targetRepos.values()) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Given — target repo setup (package.json declarations)
// ---------------------------------------------------------------------------

Given(
  'the target repo {string} has a package.json declaring {string} in devDependencies',
  function (repoName: string, packageName: string) {
    ensureTargetRepo508(repoName);
    const dir = targetRepos.get(repoName)!;
    const packageJson = JSON.stringify(
      { name: repoName, devDependencies: { [packageName]: '^1.0.0' } },
      null,
      2,
    );
    fs.writeFileSync(path.join(dir, 'package.json'), packageJson, 'utf-8');
  },
);

Given(
  'the target repo {string} has a package.json declaring no UI test framework in devDependencies',
  function (repoName: string) {
    ensureTargetRepo508(repoName);
    const dir = targetRepos.get(repoName)!;
    const packageJson = JSON.stringify(
      { name: repoName, devDependencies: {} },
      null,
      2,
    );
    fs.writeFileSync(path.join(dir, 'package.json'), packageJson, 'utf-8');
  },
);

// ---------------------------------------------------------------------------
// Then — placeholder removal assertions
// ---------------------------------------------------------------------------

Then(
  'the artefact file at {string} in target repo {string} no longer contains the slice-#507 observability-surfaces TODO placeholder marker',
  function (relPath: string, repoName: string) {
    const content = readArtefactFile508(relPath, repoName);
    const placeholder = '<!-- TODO (slice #3, issue ??):';
    assert.ok(
      !content.includes(placeholder),
      `Expected "${relPath}" in "${repoName}" to NOT contain the TODO placeholder but it does`,
    );
  },
);

// ---------------------------------------------------------------------------
// Then — Observability Surfaces section assertions
// ---------------------------------------------------------------------------

Then(
  'the Observability Surfaces section in target repo {string} has at least one populated table data row',
  function (repoName: string) {
    const section = extractObservabilitySurfacesSection(repoName);
    const dataRows = getTableDataRows(section);
    assert.ok(
      dataRows.length >= 1,
      `Expected at least one populated table data row in Observability Surfaces section of "${repoName}" but found ${dataRows.length}`,
    );
  },
);

Then(
  'the Observability Surfaces section in target repo {string} lists at least one DOM-based evidence entry',
  function (repoName: string) {
    assertSectionContains(repoName, 'dom', true);
  },
);

Then(
  'the Observability Surfaces section in target repo {string} lists at least one screenshot-based evidence entry',
  function (repoName: string) {
    assertSectionContains(repoName, 'screenshot', true);
  },
);

Then(
  'the Observability Surfaces section in target repo {string} lists at least one state-file evidence entry',
  function (repoName: string) {
    assertSectionContains(repoName, 'state file', true);
  },
);

Then(
  'the Observability Surfaces section in target repo {string} lists at least one recorded-request evidence entry',
  function (repoName: string) {
    assertSectionContains(repoName, 'recorded', true);
  },
);

Then(
  'the Observability Surfaces section in target repo {string} lists at least one exit-code evidence entry',
  function (repoName: string) {
    assertSectionContains(repoName, 'exit code', true);
  },
);

Then(
  'the Observability Surfaces section in target repo {string} lists no DOM-based evidence entries',
  function (repoName: string) {
    assertSectionContains(repoName, 'dom', false);
  },
);

Then(
  'the Observability Surfaces section in target repo {string} lists no screenshot-based evidence entries',
  function (repoName: string) {
    assertSectionContains(repoName, 'screenshot', false);
  },
);

// ---------------------------------------------------------------------------
// Then — Markdown table layout assertions
// ---------------------------------------------------------------------------

Then(
  'the Observability Surfaces section in target repo {string} begins with a Markdown table header row',
  function (repoName: string) {
    const section = extractObservabilitySurfacesSection(repoName);
    const firstTableLine = section.split('\n').find((l) => l.startsWith('|'));
    assert.ok(
      firstTableLine !== undefined,
      `Expected Observability Surfaces section in "${repoName}" to contain a Markdown table but no lines starting with "|" were found`,
    );
    const pipeCount = (firstTableLine.match(/\|/g) ?? []).length;
    assert.ok(
      pipeCount >= 3,
      `Expected the first table line to have at least 3 "|" separators (header row) but got ${pipeCount}: ${firstTableLine}`,
    );
  },
);

Then(
  'the Observability Surfaces section in target repo {string} has a Markdown table separator row immediately beneath the header row',
  function (repoName: string) {
    const section = extractObservabilitySurfacesSection(repoName);
    const tableLines = section.split('\n').filter((l) => l.startsWith('|'));
    assert.ok(
      tableLines.length >= 2,
      `Expected at least 2 table lines in Observability Surfaces section of "${repoName}" but found ${tableLines.length}`,
    );
    const separatorRow = tableLines[1];
    const isSeparator = /^\|[-:\s|]+\|$/.test(separatorRow);
    assert.ok(
      isSeparator,
      `Expected the second table line to be a Markdown separator row (e.g. |---|---|) but got: ${separatorRow}`,
    );
  },
);

Then(
  'the Observability Surfaces section in target repo {string} has at least two Markdown table data rows under the separator row',
  function (repoName: string) {
    const section = extractObservabilitySurfacesSection(repoName);
    const dataRows = getTableDataRows(section);
    assert.ok(
      dataRows.length >= 2,
      `Expected at least 2 Markdown table data rows in Observability Surfaces section of "${repoName}" but found ${dataRows.length}`,
    );
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureTargetRepo508(repoName: string): void {
  if (!targetRepos.has(repoName)) {
    const safe = repoName.replace(/[^a-z0-9]/gi, '-');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `adw-init-508-${safe}-`));
    targetRepos.set(repoName, dir);
  }
}

function readArtefactFile508(relPath: string, repoName: string): string {
  const dir = targetRepos.get(repoName);
  assert.ok(dir, `Target repo "${repoName}" not found`);
  const absPath = path.join(dir, relPath);
  assert.ok(
    fs.existsSync(absPath),
    `Expected artefact file at "${absPath}" but it does not exist`,
  );
  return fs.readFileSync(absPath, 'utf-8');
}

function extractObservabilitySurfacesSection(repoName: string): string {
  const content = readArtefactFile508('features/regression/vocabulary.md', repoName);
  const startMarker = '## Observability Surfaces';
  const startIdx = content.indexOf(startMarker);
  assert.ok(
    startIdx >= 0,
    `Expected "features/regression/vocabulary.md" in "${repoName}" to contain "## Observability Surfaces" section`,
  );
  const afterStart = content.slice(startIdx + startMarker.length);
  const nextHeadingIdx = afterStart.indexOf('\n## ');
  return nextHeadingIdx >= 0 ? afterStart.slice(0, nextHeadingIdx) : afterStart;
}

function getTableDataRows(section: string): string[] {
  const tableLines = section.split('\n').filter((l) => l.startsWith('|'));
  // Skip header row (index 0) and separator row (index 1)
  return tableLines.slice(2);
}

function assertSectionContains(
  repoName: string,
  keyword: string,
  shouldContain: boolean,
): void {
  const section = extractObservabilitySurfacesSection(repoName);
  const found = section.toLowerCase().includes(keyword.toLowerCase());
  if (shouldContain) {
    assert.ok(
      found,
      `Expected Observability Surfaces section in "${repoName}" to contain "${keyword}" but it does not`,
    );
  } else {
    assert.ok(
      !found,
      `Expected Observability Surfaces section in "${repoName}" to NOT contain "${keyword}" but it does`,
    );
  }
}
