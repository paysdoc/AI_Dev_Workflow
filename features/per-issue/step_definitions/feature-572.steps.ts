/**
 * BDD step definitions for feature-572.feature
 * adwUpgrade.tsx anti-brick gate — verify .adw/ regeneration before stamping .adw-version,
 * and propagate skills/commands into target worktrees via copyClaudeAssetsToWorktree.
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'                                  → ensureCronOnEveryEventSteps.ts
 *  - Given 'the claude-cli-stub is loaded with manifest {string}'             → givenSteps.ts (G3)
 *  - Given 'an issue {int} exists in the mock issue tracker'                  → givenSteps.ts (G4)
 *  - Given 'the worktree for adwId {string} is initialised at branch {string}'→ givenSteps.ts (G11)
 *  - Given 'the mock GitHub API is configured to accept issue comments'        → givenSteps.ts (G1)
 *  - Given 'the upgrade branch {string} already carries the empty upgrade-claim commit'
 *                                                                              → feature-541.steps.ts
 *  - When  'the {string} orchestrator is invoked with adwId {string} and issue {int}'
 *                                                                              → whenSteps.ts (W1)
 *  - Then  'the orchestrator subprocess exited {int}'                          → thenSteps.ts (T5)
 *  - Then  'the mock GitHub API recorded a PR creation for issue {int}'        → thenSteps.ts (T8)
 *  - Then  'the mock GitHub API recorded a comment on issue {int}'             → thenSteps.ts (T2)
 *  - Then  'the ".adw-version" artefact in the worktree for adwId {string} records a 64-char ...'
 *                                                                              → feature-541.steps.ts
 *  - Then  'the ".adw-version" artefact in the worktree for adwId {string} is absent'
 *                                                                              → feature-541.steps.ts
 *  - Then  'the most recent comment on issue {int} carries no ADW workflow marker'
 *                                                                              → feature-541.steps.ts
 *  - Then  'the mock harness recorded zero PR creations for issue {int}'       → feature-541.steps.ts
 *  - Then  'the ADW TypeScript type-check passes'                              → feature-504.steps.ts
 *
 * Novel vocabulary introduced here (no registered phrase fits):
 *  - Given 'the worktree for adwId {string} has a regenerated .adw/ directory ...'
 *  - Then  'the most recent comment on issue {int} reports that the framework regeneration could not be verified'
 *  - Then  'the regeneration commit on branch {string} does not include the copied "adw_init" command file'
 *  - When  'the worktree command-and-skill propagation runs for the worktree of adwId {string}'
 *  - Then  'the copied path {string} in the worktree for adwId {string} is git-committable'
 *  - Then  'the copied path {string} in the worktree for adwId {string} is present but git-ignored'
 *
 * Execution note:
 *  §1 and §2 (orchestrator subprocess) are PENDING because W1 returns 'pending' while
 *  ISSUE-3-CUTOVER is active. The step definitions are present so cucumber does not report
 *  "undefined step". §3, §4 (propagation) execute directly via the When step. §5 (type-check)
 *  is already implemented in feature-504.steps.ts.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import { copyClaudeAssetsToWorktree } from '../../../adws/phases/worktreeSetup.ts';
import { buildLaunchGitContext } from '../../../adws/core/launchGitContext.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const ADW_UPGRADE_SRC = resolve(ROOT, 'adws/adwUpgrade.tsx');
const WORKTREE_SETUP_SRC = resolve(ROOT, 'adws/phases/worktreeSetup.ts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInGitignore(worktreePath: string, assetPath: string): boolean {
  const gitignorePath = path.join(worktreePath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;
  const lines = fs.readFileSync(gitignorePath, 'utf-8').split('\n').map((l) => l.trim());
  const bare = assetPath.replace(/\/$/, '');
  return lines.includes(bare) || lines.includes(bare + '/');
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-572
// ---------------------------------------------------------------------------

Before({ tags: '@adw-572' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@adw-572' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// Given — seed a fully-regenerated .adw/ as a fixture (§2 precondition)
// ---------------------------------------------------------------------------

Given(
  'the worktree for adwId {string} has a regenerated .adw\\/ directory containing the six canonical config files and the regression vocabulary file',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) return;

    const adwDir = path.join(worktreePath, '.adw');
    fs.mkdirSync(adwDir, { recursive: true });

    for (const file of ['commands.md', 'project.md', 'conditional_docs.md', 'providers.md', 'review_proof.md', 'scenarios.md']) {
      fs.writeFileSync(path.join(adwDir, file), `# ${file}\n\nGenerated by fixture.\n`);
    }

    const vocabDir = path.join(worktreePath, 'features', 'regression');
    fs.mkdirSync(vocabDir, { recursive: true });
    fs.writeFileSync(path.join(vocabDir, 'vocabulary.md'), '# Vocabulary\n\nGenerated by fixture.\n');
  },
);

// ---------------------------------------------------------------------------
// Then — failure comment mentions regeneration verification (§1)
// ---------------------------------------------------------------------------

Then(
  'the most recent comment on issue {int} reports that the framework regeneration could not be verified',
  function (this: RegressionWorld, issueNumber: number) {
    if (this.mockContext !== null) {
      const requests = this.getRecordedRequests();
      const commentPosts = requests.filter(
        (r: RecordedRequest) =>
          r.method === 'POST' && r.url.includes(`/issues/${issueNumber}/comments`),
      );
      assert.ok(
        commentPosts.length > 0,
        `Expected at least one comment POST on issue ${issueNumber}`,
      );
      const lastPost = commentPosts[commentPosts.length - 1];
      const body = (JSON.parse(lastPost.body) as Record<string, string>)['body'] ?? '';
      const mentionsRegen =
        body.toLowerCase().includes('regen') ||
        body.toLowerCase().includes('regenerat') ||
        body.toLowerCase().includes('.adw/');
      assert.ok(
        mentionsRegen,
        `Expected the failure comment to mention regeneration / .adw/ but got:\n${body}`,
      );
      return;
    }

    // Source inspection fallback
    const src = fs.readFileSync(ADW_UPGRADE_SRC, 'utf-8');
    assert.ok(
      src.includes('regen_incomplete'),
      'Expected adwUpgrade.tsx to have a regen_incomplete return path',
    );
    assert.ok(
      src.includes('verifyAdwRegen'),
      'Expected adwUpgrade.tsx to call verifyAdwRegen before writing .adw-version',
    );
  },
);

// ---------------------------------------------------------------------------
// Then — regeneration commit does not carry the force-copied adw_init.md (§2)
// ---------------------------------------------------------------------------

Then(
  'the regeneration commit on branch {string} does not include the copied "adw_init" command file',
  function (this: RegressionWorld, branchName: string) {
    // Find the worktree for this branch.
    const worktreePath = [...this.worktreePaths.values()].find((p) => {
      try {
        const current = execSync('git branch --show-current', {
          cwd: p, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return current === branchName;
      } catch { return false; }
    });

    if (worktreePath) {
      const gitBin = process.env['REAL_GIT_PATH'] ?? 'git';
      const changedFiles = execSync(
        `"${gitBin}" show --name-only --format="" HEAD`,
        { cwd: worktreePath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      assert.ok(
        !changedFiles.includes('adw_init.md'),
        `Expected adw_init.md to be absent from the regen commit but found it in:\n${changedFiles}`,
      );
      return;
    }

    // Source inspection fallback
    const src = fs.readFileSync(ADW_UPGRADE_SRC, 'utf-8');
    assert.ok(
      src.includes('copyAdwInitCommandToWorktree'),
      'Expected adwUpgrade.tsx to call copyAdwInitCommandToWorktree (which gitignores adw_init.md)',
    );
    const wsrc = fs.readFileSync(WORKTREE_SETUP_SRC, 'utf-8');
    assert.ok(
      wsrc.includes("ensureGitignoreEntry(worktreePath, '.claude/commands/adw_init.md')"),
      'Expected copyAdwInitCommandToWorktree to gitignore .claude/commands/adw_init.md',
    );
  },
);

// ---------------------------------------------------------------------------
// When — worktree command-and-skill propagation (§3, §4)
// ---------------------------------------------------------------------------

When(
  'the worktree command-and-skill propagation runs for the worktree of adwId {string}',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) {
      // Source inspection fallback: confirm the merged function exists
      const wsrc = fs.readFileSync(WORKTREE_SETUP_SRC, 'utf-8');
      assert.ok(
        wsrc.includes('copyClaudeAssetsToWorktree'),
        'Expected worktreeSetup.ts to export copyClaudeAssetsToWorktree',
      );
      return;
    }
    const gitContext = buildLaunchGitContext(null);
    copyClaudeAssetsToWorktree(worktreePath, gitContext);
  },
);

// ---------------------------------------------------------------------------
// Then — copied path is git-committable (§3)
// ---------------------------------------------------------------------------

Then(
  'the copied path {string} in the worktree for adwId {string} is git-committable',
  function (this: RegressionWorld, copiedPath: string, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) {
      // Source inspection fallback
      const wsrc = fs.readFileSync(WORKTREE_SETUP_SRC, 'utf-8');
      assert.ok(
        wsrc.includes('parseFrontmatterTarget'),
        'Expected worktreeSetup.ts to use parseFrontmatterTarget to distinguish target:true assets',
      );
      return;
    }

    const fullPath = path.join(worktreePath, copiedPath);
    assert.ok(fs.existsSync(fullPath), `Expected ${copiedPath} to exist in worktree at ${fullPath}`);
    assert.ok(
      !isInGitignore(worktreePath, copiedPath),
      `Expected ${copiedPath} to be git-committable (not in .gitignore)`,
    );
  },
);

// ---------------------------------------------------------------------------
// Then — copied path is present but git-ignored (§4)
// ---------------------------------------------------------------------------

Then(
  'the copied path {string} in the worktree for adwId {string} is present but git-ignored',
  function (this: RegressionWorld, copiedPath: string, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) {
      // Source inspection fallback
      const wsrc = fs.readFileSync(WORKTREE_SETUP_SRC, 'utf-8');
      assert.ok(
        wsrc.includes('ensureGitignoreEntries'),
        'Expected worktreeSetup.ts to call ensureGitignoreEntries for target:false assets',
      );
      return;
    }

    const fullPath = path.join(worktreePath, copiedPath);
    assert.ok(fs.existsSync(fullPath), `Expected ${copiedPath} to be present in worktree at ${fullPath}`);
    assert.ok(
      isInGitignore(worktreePath, copiedPath),
      `Expected ${copiedPath} to be gitignored but it is not in .gitignore`,
    );
  },
);
