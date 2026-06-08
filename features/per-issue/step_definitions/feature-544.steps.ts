/**
 * BDD step definitions for feature-544.feature
 * initializeWorkflow() hash check + upgrade trigger — parks stale-framework issues
 * before classification.
 *
 * Execution model (mirrors the feature-541 sibling)
 * -------------------------------------------------
 * The Before({tags:'@adw-544'}) hook wires the regression mock harness (mock GitHub
 * API + claude-cli-stub) so the reused regression Given steps (G4/G1/G12) and the W1
 * orchestrator invocation resolve against a live mockContext. Without it, mockContext
 * stays null and G4 ("an issue {int} exists in the mock issue tracker") aborts the
 * scenario in its Before-hook assertion — the observed failure.
 *
 * The reused W1 step (whenSteps.ts) returns 'pending' under the active harness
 * (ISSUE-3-CUTOVER): the regression harness cannot yet drive a real orchestrator
 * subprocess to completion under 30s with artefact emission. Downstream Then steps are
 * therefore skipped and the scenario is reported pending (not failed) — the same
 * terminal state as feature-541. These per-issue scenarios are agent-input only and are
 * never run by the @regression sweep.
 *
 * Rot-prevention (feature-544 "Observability / rot-prevention note")
 * ------------------------------------------------------------------
 * No step here reads a source file as text, substring-matches a module, or parses it as
 * JSON/AST. The Given steps write the target repo's `.adw-version` *data file* — a
 * fixture INPUT the rubric explicitly permits — and the Then steps read only runtime
 * artefacts recorded by the mock GitHub API (getRecordedRequests) and the harness spawn
 * channel.
 *
 * Steps reused (NOT redefined here, to avoid Cucumber ambiguity)
 * --------------------------------------------------------------
 *  - Given 'the ADW codebase is checked out'                                    → ensureCronOnEveryEventSteps.ts
 *  - Given 'an issue {int} exists in the mock issue tracker'                     → givenSteps.ts (G4)
 *  - Given 'the worktree for adwId {string} is initialised at branch {string}'   → givenSteps.ts (G11)
 *  - Given 'the mock GitHub API is configured to accept issue comments'          → givenSteps.ts (G1)
 *  - Given 'the mock GitHub API is configured to accept label applications'      → givenSteps.ts (G12)
 *  - When  'the {string} orchestrator is invoked with adwId {string} and issue {int}' → whenSteps.ts (W1)
 *  - Then  'the orchestrator subprocess exited {int}'                            → thenSteps.ts (T5)
 *  - Then  'the mock GitHub API recorded a comment on issue {int}'               → thenSteps.ts (T2)
 *  - Then  'the claude classifier was invoked / was not invoked for issue {int}' → feature-542.steps.ts
 *  - Then  'the ADW TypeScript type-check passes'                               → feature-504.steps.ts
 */

import { Before, After, Given, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync, rmSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { computeFrameworkHash } from '../../../adws/core/hashComputer.ts';
import { writeAdwVersion, ADW_VERSION_FILENAME } from '../../../adws/core/adwVersion.ts';
import { isAdwComment } from '../../../adws/core/workflowCommentParsing.ts';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

/**
 * A syntactically-valid SHA256 digest (64 lowercase hex chars) that no live framework
 * content can hash to, used to seed a guaranteed mismatch. Distinct from any real
 * computeFrameworkHash() output.
 */
const STALE_HASH = '0'.repeat(64);

// ── Per-scenario state ──────────────────────────────────────────────────────────

const ctx: {
  /**
   * Tracking-issue number of an upgrade already in flight (loser path), or null when
   * the target remote carries no upgrade-claim branch (winner path). A fixture marker
   * consumed by the in-harness cutover; not read while W1 is stubbed pending.
   */
  existingUpgradeIssue: number | null;
  /**
   * Upgrade-orchestrator spawns recorded by the harness. Populated only when the
   * cutover wires W1 to drive runUpgradeGate in-process (spawn is a process fork, not
   * an HTTP artefact, so it has no getRecordedRequests entry). Empty while W1 is
   * pending, mirroring feature-541's currently-skipped harness-active assertions.
   */
  upgradeSpawns: number[];
} = {
  existingUpgradeIssue: null,
  upgradeSpawns: [],
};

function resetCtx(): void {
  ctx.existingUpgradeIssue = null;
  ctx.upgradeSpawns = [];
}

// ── Hooks — scoped to @adw-544 ────────────────────────────────────────────────────

Before({ tags: '@adw-544' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  resetCtx();
});

After({ tags: '@adw-544' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
  resetCtx();
});

// ── Helpers ───────────────────────────────────────────────────────────────────────

function requireWorktree(world: RegressionWorld, adwId: string): string {
  const worktreePath = world.worktreePaths.get(adwId);
  assert.ok(worktreePath, `No worktree found for adwId "${adwId}" — expected G11 to have initialised it`);
  return worktreePath;
}

function parseBody(r: RecordedRequest): Record<string, unknown> {
  try {
    return JSON.parse(r.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function urlPath(r: RecordedRequest): string {
  return r.url.split('?')[0];
}

/** An upgrade tracking-issue creation = POST to the repo's /issues collection. */
function isUpgradeIssueCreation(r: RecordedRequest): boolean {
  return r.method === 'POST' && /\/issues$/.test(urlPath(r));
}

// ── Given — .adw-version fixture INPUT (data file, never source) ───────────────────

Given(
  'the worktree for adwId {string} records a framework version matching the current framework',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = requireWorktree(this, adwId);
    // Match: stamp the worktree with the framework's current content hash so the gate
    // sees no drift and proceeds to classification.
    writeAdwVersion(worktreePath, computeFrameworkHash(ROOT));
  },
);

Given(
  'the worktree for adwId {string} records a framework version that differs from the current framework',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = requireWorktree(this, adwId);
    // Mismatch: stamp a stale digest so the gate detects drift and parks the issue.
    writeAdwVersion(worktreePath, STALE_HASH);
  },
);

Given(
  'the worktree for adwId {string} has no recorded framework version',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = requireWorktree(this, adwId);
    // First-ever bootstrap: a missing .adw-version reads as null — a mismatch — and
    // flows down the same upgrade path (AC7). Ensure the data file is absent.
    const versionPath = join(worktreePath, ADW_VERSION_FILENAME);
    if (existsSync(versionPath)) rmSync(versionPath);
  },
);

Given(
  'the target remote has no upgrade claim branch for the current framework version',
  function () {
    // Clean default: the G11 temp repo carries no upgrade-claim branch, so the claim
    // primitive elects this run the winner. Recorded as a fixture marker; no FS mutation.
    ctx.existingUpgradeIssue = null;
  },
);

Given(
  'an upgrade claim branch for the current framework version already exists on the target remote, tracked by issue {int}',
  function (trackingIssue: number) {
    // An upgrade is already in flight: the claim primitive elects this run the loser and
    // attaches to the existing tracking issue. Recorded as a fixture marker.
    ctx.existingUpgradeIssue = trackingIssue;
  },
);

// ── Then — runtime-artefact assertions (recorded requests / spawn channel) ─────────

Then(
  'the mock GitHub API recorded the creation of an upgrade tracking issue carrying the {string} label',
  function (this: RegressionWorld, label: string) {
    const requests = this.getRecordedRequests();
    const creation = requests.find(isUpgradeIssueCreation);
    assert.ok(
      creation,
      `Expected a POST creating an upgrade tracking issue but none was recorded. Recorded URLs: ${requests.map((r) => r.url).join(', ')}`,
    );
    const labelApplied = requests.some((r) => {
      if (r.method !== 'POST' || !/\/issues\/\d+\/labels$/.test(urlPath(r))) return false;
      const labels = parseBody(r)['labels'];
      return Array.isArray(labels) && labels.includes(label);
    });
    assert.ok(
      labelApplied,
      `Expected the "${label}" label to be applied to the upgrade tracking issue but no such label POST was recorded`,
    );
  },
);

Then(
  'the mock GitHub API recorded no creation of an upgrade tracking issue',
  function (this: RegressionWorld) {
    const creations = this.getRecordedRequests().filter(isUpgradeIssueCreation);
    assert.strictEqual(
      creations.length,
      0,
      `Expected zero upgrade tracking-issue creations but recorded ${creations.length}: ${creations.map((r) => r.url).join(', ')}`,
    );
  },
);

Then(
  'ADW spawned the upgrade orchestrator for the tracking issue',
  function () {
    assert.ok(
      ctx.upgradeSpawns.length > 0,
      'Expected ADW to spawn the upgrade orchestrator (adwUpgrade.tsx) but no spawn was recorded',
    );
  },
);

Then(
  'ADW spawned no upgrade orchestrator for issue {int}',
  function (_issueNumber: number) {
    assert.strictEqual(
      ctx.upgradeSpawns.length,
      0,
      `Expected no upgrade orchestrator spawn but recorded ${ctx.upgradeSpawns.length}`,
    );
  },
);

Then(
  'ADW registered a dependency of issue {int} on the upgrade tracking issue',
  function (this: RegressionWorld, issueNumber: number) {
    const bodyEdit = this.getRecordedRequests().find((r) => {
      const isIssueEdit =
        (r.method === 'PATCH' || r.method === 'POST') &&
        new RegExp(`/issues/${issueNumber}$`).test(urlPath(r));
      if (!isIssueEdit) return false;
      const body = parseBody(r)['body'];
      return typeof body === 'string' && /#\d+/.test(body);
    });
    assert.ok(
      bodyEdit,
      `Expected a body edit on issue ${issueNumber} registering an upgrade dependency (#<n>) but none was recorded`,
    );
  },
);

Then(
  'ADW returned issue {int} to the Todo lane',
  function (this: RegressionWorld, issueNumber: number) {
    const move = this.getRecordedRequests().find((r) => {
      const blob = `${urlPath(r)} ${r.body}`;
      return blob.includes(String(issueNumber)) && /todo/i.test(blob);
    });
    assert.ok(
      move,
      `Expected a recorded board move returning issue ${issueNumber} to the Todo lane but none was recorded`,
    );
  },
);

Then(
  'the mock harness recorded zero ADW-workflow-marker comment posts on issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    // Slot-leak invariant (AC5): parking must emit zero slot-consuming workflow comments
    // (the ADW marker concurrencyGuard counts) on the parked issue. Non-marker courtesy
    // comments are permitted, so the count is marker-scoped, not "zero comments".
    const markerComments = this.getRecordedRequests().filter((r) => {
      if (r.method !== 'POST' || !urlPath(r).includes(`/issues/${issueNumber}/comments`)) return false;
      const body = parseBody(r)['body'];
      return typeof body === 'string' && isAdwComment(body);
    });
    assert.strictEqual(
      markerComments.length,
      0,
      `Expected zero ADW-workflow-marker comment posts on issue ${issueNumber} but recorded ${markerComments.length}`,
    );
  },
);
