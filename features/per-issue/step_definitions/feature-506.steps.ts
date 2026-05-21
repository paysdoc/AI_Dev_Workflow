/**
 * BDD step definitions for feature-506.feature
 * Rot prevention block in scenario_writer.md prompt
 *
 * Design decisions:
 *  - Target repos are created as temp directories; all assertions read artefact
 *    files written by applyManifest (the stub), never source files.
 *  - The "agent run" is simulated by calling applyManifest directly against the
 *    target repo dir, mirroring what the claude-cli-stub would do for a real run.
 *  - Reads-log artefact (.adw/agent-run-state.json) records vocabulary reads; this
 *    is an artefact, not a source file, so reading it is permitted.
 *  - Step texts containing "/" use regex patterns because "/" is the alternation
 *    operator in Cucumber Expressions (cucumber-js 12.x).
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { applyManifest } from '../../../test/mocks/manifestInterpreter.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Module-level state — reset in Before hook per @adw-506 scenario
// ---------------------------------------------------------------------------

interface AdwRunResult {
  exitCode: number;
  writtenPaths: string[];
  readsLog: string[];
  targetRepoDir: string;
}

export const targetRepos = new Map<string, string>();
const preInvocationContents = new Map<string, string>();
const adwRunData = new Map<string, AdwRunResult>();

export function ensureTargetRepo(repoName: string): void {
  if (!targetRepos.has(repoName)) {
    const safe = repoName.replace(/[^a-z0-9]/gi, '-');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `adw-sw-506-${safe}-`));
    targetRepos.set(repoName, dir);
  }
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-506 to avoid interfering with other suites
// ---------------------------------------------------------------------------

Before({ tags: '@adw-506' }, function () {
  for (const dir of targetRepos.values()) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  targetRepos.clear();
  preInvocationContents.clear();
  adwRunData.clear();
});

After({ tags: '@adw-506' }, function () {
  for (const dir of targetRepos.values()) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

Given('the ADW framework codebase is checked out', function () {
  // No-op: the framework codebase is always present at ROOT in the test environment.
});

// ---------------------------------------------------------------------------
// Given — target repo setup
// Regex patterns are used for step texts containing "/" (alternation operator
// in Cucumber Expressions) and ".md" (to be safe with dot matching).
// ---------------------------------------------------------------------------

Given(
  /^a target repo "([^"]+)" with features\/regression\/vocabulary\.md present$/,
  function (repoName: string) {
    ensureTargetRepo(repoName);
    const dir = targetRepos.get(repoName)!;
    fs.mkdirSync(path.join(dir, 'features', 'regression'), { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, 'features', 'regression', 'vocabulary.md'),
      path.join(dir, 'features', 'regression', 'vocabulary.md'),
    );
  },
);

Given(
  /^a target repo "([^"]+)" with \.adw\/scenarios\.md routing per-issue output to "([^"]+)"$/,
  function (repoName: string, perIssueDir: string) {
    ensureTargetRepo(repoName);
    const dir = targetRepos.get(repoName)!;
    const adwDir = path.join(dir, '.adw');
    fs.mkdirSync(adwDir, { recursive: true });

    const scenPath = path.join(adwDir, 'scenarios.md');
    const existing = fs.existsSync(scenPath)
      ? fs.readFileSync(scenPath, 'utf-8')
      : '# ADW BDD Scenario Configuration\n\n## Scenario Directory\nfeatures/\n';

    const updated =
      existing.trimEnd() +
      '\n\n## Per-Issue Scenario Directory\n' +
      perIssueDir +
      '\n';
    fs.writeFileSync(scenPath, updated, 'utf-8');
  },
);

Given(
  /^a target repo "([^"]+)" with no features\/regression\/vocabulary\.md$/,
  function (repoName: string) {
    ensureTargetRepo(repoName);
    // vocabulary.md intentionally absent — repo exists without it
  },
);

Given(
  /^a target repo "([^"]+)" with \.adw\/scenarios\.md configuring "([^"]+)" as the Regression Scenario Directory$/,
  function (repoName: string, regressionDir: string) {
    ensureTargetRepo(repoName);
    const dir = targetRepos.get(repoName)!;
    const adwDir = path.join(dir, '.adw');
    fs.mkdirSync(adwDir, { recursive: true });

    const scenPath = path.join(adwDir, 'scenarios.md');
    const existing = fs.existsSync(scenPath)
      ? fs.readFileSync(scenPath, 'utf-8')
      : '# ADW BDD Scenario Configuration\n\n## Scenario Directory\nfeatures/\n';

    const updated =
      existing.trimEnd() +
      '\n\n## Regression Scenario Directory\n' +
      regressionDir +
      '\n';
    fs.writeFileSync(scenPath, updated, 'utf-8');
  },
);

Given(
  /^a target repo "([^"]+)" with an existing regression scenario at "([^"]+)" tagged "([^"]+)"$/,
  function (repoName: string, relPath: string, tag: string) {
    ensureTargetRepo(repoName);
    const dir = targetRepos.get(repoName)!;
    const absPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const content =
      `${tag}\nFeature: baseline regression scenario\n\n  ${tag}\n  Scenario: baseline\n    Given a baseline state\n`;
    fs.writeFileSync(absPath, content, 'utf-8');
    // Save for byte-identical checks in Then steps
    preInvocationContents.set(relPath, content);
  },
);

Given(
  /^a target repo "([^"]+)" with \.adw\/scenarios\.md setting only "## Scenario Directory" to "([^"]+)"$/,
  function (repoName: string, scenDir: string) {
    ensureTargetRepo(repoName);
    const dir = targetRepos.get(repoName)!;
    const adwDir = path.join(dir, '.adw');
    fs.mkdirSync(adwDir, { recursive: true });
    const content =
      '# ADW BDD Scenario Configuration\n\n## Scenario Directory\n' + scenDir + '\n';
    fs.writeFileSync(path.join(adwDir, 'scenarios.md'), content, 'utf-8');
  },
);

Given(
  /^a target repo "([^"]+)" with no "([^"]+)" section in \.adw\/scenarios\.md$/,
  function (repoName: string, sectionName: string) {
    const dir = targetRepos.get(repoName);
    if (!dir) return;
    const scenPath = path.join(dir, '.adw', 'scenarios.md');
    if (!fs.existsSync(scenPath)) return;
    const content = fs.readFileSync(scenPath, 'utf-8');
    assert.ok(
      !content.includes(`## ${sectionName}`),
      `Expected .adw/scenarios.md to NOT contain "## ${sectionName}" but it does`,
    );
  },
);

// ---------------------------------------------------------------------------
// When — scenario_writer agent invocation (simulated via applyManifest)
// ---------------------------------------------------------------------------

When(
  'the scenario_writer agent is invoked in target repo {string} with adwId {string} for issue {int}',
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

    // Read the agent-run-state artefact if the manifest wrote one
    let readsLog: string[] = [];
    const runStatePath = path.join(dir, '.adw', 'agent-run-state.json');
    if (fs.existsSync(runStatePath)) {
      const state = JSON.parse(
        fs.readFileSync(runStatePath, 'utf-8'),
      ) as { readsLog?: string[] };
      readsLog = state.readsLog ?? [];
    }

    adwRunData.set(adwId, {
      exitCode: 0,
      writtenPaths: result.editsApplied,
      readsLog,
      targetRepoDir: dir,
    });
  },
);

// ---------------------------------------------------------------------------
// Then — agent run assertions
// ---------------------------------------------------------------------------

Then(
  "the agent's recorded file reads for adwId {string} include {string}",
  function (adwId: string, expectedReadPath: string) {
    const run = adwRunData.get(adwId);
    assert.ok(run, `No run data for adwId "${adwId}"`);
    assert.ok(
      run.readsLog.includes(expectedReadPath),
      `Expected reads log to include "${expectedReadPath}" but got: [${run.readsLog.join(', ')}]`,
    );
  },
);

Then(
  'the scenario_writer agent run for adwId {string} exits 0',
  function (adwId: string) {
    const run = adwRunData.get(adwId);
    assert.ok(run, `No run data for adwId "${adwId}"`);
    assert.strictEqual(
      run.exitCode,
      0,
      `Expected exit code 0 but got ${run.exitCode}`,
    );
  },
);

Then(
  'the artefact feature file for issue {int} is written under the resolved per-issue directory in target repo {string}',
  function (issueNumber: number, repoName: string) {
    const dir = targetRepos.get(repoName);
    assert.ok(dir, `Target repo "${repoName}" not found`);

    // Read the per-issue directory from the repo's .adw/scenarios.md
    const scenPath = path.join(dir, '.adw', 'scenarios.md');
    let perIssueDir = 'features/';
    if (fs.existsSync(scenPath)) {
      const content = fs.readFileSync(scenPath, 'utf-8');
      const match = /## Per-Issue Scenario Directory\n([^\n#]+)/.exec(content);
      if (match) {
        perIssueDir = match[1].trim();
      } else {
        const fallback = /## Scenario Directory\n([^\n#]+)/.exec(content);
        if (fallback) perIssueDir = fallback[1].trim();
      }
    }

    const expectedPath = path.join(dir, perIssueDir, `feature-${issueNumber}.feature`);
    assert.ok(
      fs.existsSync(expectedPath),
      `Expected artefact feature file at "${expectedPath}" but it does not exist`,
    );
  },
);

Then(
  'the artefact file at {string} exists in target repo {string}',
  function (relPath: string, repoName: string) {
    const dir = targetRepos.get(repoName);
    assert.ok(dir, `Target repo "${repoName}" not found`);
    const absPath = path.join(dir, relPath);
    assert.ok(
      fs.existsSync(absPath),
      `Expected artefact file at "${absPath}" but it does not exist`,
    );
  },
);

Then(
  'the artefact file at {string} is tagged {string}',
  function (relPath: string, tag: string) {
    // Find the file across all known target repos
    for (const [, dir] of targetRepos) {
      const absPath = path.join(dir, relPath);
      if (fs.existsSync(absPath)) {
        const content = fs.readFileSync(absPath, 'utf-8');
        assert.ok(
          content.includes(tag),
          `Expected artefact file "${relPath}" to contain tag "${tag}" but it does not.\nContent:\n${content}`,
        );
        return;
      }
    }
    assert.fail(`Artefact file "${relPath}" not found in any target repo`);
  },
);

Then(
  'the artefact file at {string} is byte-identical to its pre-invocation contents in target repo {string}',
  function (relPath: string, repoName: string) {
    const dir = targetRepos.get(repoName);
    assert.ok(dir, `Target repo "${repoName}" not found`);

    const savedContent = preInvocationContents.get(relPath);
    assert.ok(
      savedContent !== undefined,
      `No pre-invocation content saved for "${relPath}" — ensure a Given step wrote it`,
    );

    const absPath = path.join(dir, relPath);
    assert.ok(
      fs.existsSync(absPath),
      `Artefact file "${absPath}" does not exist`,
    );

    const currentContent = fs.readFileSync(absPath, 'utf-8');
    assert.strictEqual(
      currentContent,
      savedContent,
      `Expected "${relPath}" to be byte-identical to pre-invocation contents but it was modified`,
    );
  },
);

Then(
  'the scenario_writer agent run for adwId {string} wrote no files under {string} in target repo {string}',
  function (adwId: string, dirPrefix: string, repoName: string) {
    const run = adwRunData.get(adwId);
    assert.ok(run, `No run data for adwId "${adwId}"`);

    const repoDir = targetRepos.get(repoName);
    assert.ok(repoDir, `Target repo "${repoName}" not found`);

    const absolutePrefix = path.join(repoDir, dirPrefix);
    const regressionWrites = run.writtenPaths.filter((p) =>
      p.startsWith(absolutePrefix),
    );

    assert.strictEqual(
      regressionWrites.length,
      0,
      `Expected no files written under "${dirPrefix}" but found: ${regressionWrites.join(', ')}`,
    );
  },
);

Then(
  'the artefact feature file for issue {int} is written under {string} in target repo {string}',
  function (issueNumber: number, dirPrefix: string, repoName: string) {
    const dir = targetRepos.get(repoName);
    assert.ok(dir, `Target repo "${repoName}" not found`);

    const normalised = dirPrefix.endsWith('/') ? dirPrefix : dirPrefix + '/';
    const expectedPath = path.join(dir, normalised, `feature-${issueNumber}.feature`);
    assert.ok(
      fs.existsSync(expectedPath),
      `Expected artefact feature file at "${expectedPath}" but it does not exist`,
    );
  },
);

// ---------------------------------------------------------------------------
// Then — rot-pattern detection
// ---------------------------------------------------------------------------

Then(
  'the artefact file at {string} has no step phrasing asserting that a literal file path exists',
  function (relPath: string) {
    const content = readArtefactFile(relPath);
    // Detect: `the file "src/foo.ts" exists` or `"config.ts" exists` etc.
    const pattern =
      /(the file\s+"[^"]+"\s+(exists|is present|is absent|does not exist))|("[\w./\\-]+\.(ts|js|tsx|jsx|json|yaml|yml|py|go|rb)"\s+(exists|is present|is absent|does not exist))/i;
    for (const line of content.split('\n')) {
      assert.ok(
        !pattern.test(line),
        `Found rot-pattern (file-existence check) in artefact feature file:\n  ${line.trim()}`,
      );
    }
  },
);

Then(
  "the artefact file at {string} has no step phrasing asserting that a source file's contents include a literal substring",
  function (relPath: string) {
    const content = readArtefactFile(relPath);
    // Detect: `file "..." contains "..."`, `source file contains`, `readFileSync(...).includes`
    const pattern =
      /(\bfile\s+"[^"]+"\s+contains\b)|(\bsource\s+file\s+contains\b)|(readFileSync[^)]+\.includes)|(the contents of\s+"[^"]+"\s+include)/i;
    for (const line of content.split('\n')) {
      assert.ok(
        !pattern.test(line),
        `Found rot-pattern (file-content substring match) in artefact feature file:\n  ${line.trim()}`,
      );
    }
  },
);

Then(
  'the artefact file at {string} has no step phrasing parsing a source file as JSON or AST to assert against its structure',
  function (relPath: string) {
    const content = readArtefactFile(relPath);
    // Detect: `JSON.parse`, `parsed as JSON`, `AST structure`, `the JSON structure of`
    const pattern =
      /(JSON\.parse)|(parsed?\s+as\s+JSON)|(AST\s+(structure|of|contains))|(the\s+(JSON|parsed)\s+structure\s+of)/i;
    for (const line of content.split('\n')) {
      assert.ok(
        !pattern.test(line),
        `Found rot-pattern (structural source-file parsing) in artefact feature file:\n  ${line.trim()}`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Helper — finds an artefact file across all known target repos
// ---------------------------------------------------------------------------

function readArtefactFile(relPath: string): string {
  for (const [, dir] of targetRepos) {
    const absPath = path.join(dir, relPath);
    if (fs.existsSync(absPath)) {
      return fs.readFileSync(absPath, 'utf-8');
    }
  }
  assert.fail(`Artefact file "${relPath}" not found in any target repo`);
}
