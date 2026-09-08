/**
 * BDD step definitions for feature-753.feature
 * Dependency-unblock parser parity — a prose "- blocked by #N" dependent unblocks via the
 * SAME extractor detection uses, driven in-process through the DI seam on
 * `handleIssueClosedDependencyUnblock` (adws/triggers/issueClosedUnblockRouter.ts).
 *
 * Design
 * ------
 * No real `gh` / `listOpenIssues`: the injected `listOpenIssues` returns an in-memory
 * seeded issue array. The injected `extractDependents` is wired to the REAL production
 * proximity core (`parseKeywordProximityDependencies`) — the same superset extractor
 * detection resolves to for single-ref bodies — so the prose-matching assertion is
 * genuinely exercised and never faked. `checkEligibility` and `spawn` are recording spies
 * seeded per scenario.
 *
 * Observability / rot-prevention: every assertion reads a runtime artefact (the recorded
 * spawn set / eligibility-consultation set), never a source file's text.
 *
 * Steps reused from existing files (NOT redefined here):
 *   - Given 'the ADW codebase is checked out'    → ensureCronOnEveryEventSteps.ts (G18)
 *   - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts (T22)
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import {
  handleIssueClosedDependencyUnblock,
  type DependencyUnblockDeps,
  type OpenIssue,
} from '../../../adws/triggers/issueClosedUnblockRouter.ts';
import { parseKeywordProximityDependencies } from '../../../adws/triggers/issueDependencies.ts';
import type { RepoIdentifier } from '../../../adws/providers/types.ts';
import { Platform } from '../../../adws/providers/types.ts';
import type { EligibilityResult } from '../../../adws/triggers/issueEligibility.ts';

// ── Per-scenario state ──────────────────────────────────────────────────────────

interface Ctx753 {
  repoInfo: RepoIdentifier;
  /** Seeded open issues (injected listOpenIssues input). */
  issues: OpenIssue[];
  /** issueNumber → seeded eligibility verdict (injected checkEligibility input). */
  eligibilityVerdicts: Map<number, EligibilityResult>;
  /** issue numbers the injected spawn spy was asked to spawn. */
  spawned: number[];
  /** issue numbers the injected checkEligibility spy was consulted about. */
  eligibilityChecked: number[];
}

const ctx: Ctx753 = {
  repoInfo: { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub },
  issues: [],
  eligibilityVerdicts: new Map(),
  spawned: [],
  eligibilityChecked: [],
};

function resetCtx(): void {
  ctx.repoInfo = { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub };
  ctx.issues = [];
  ctx.eligibilityVerdicts.clear();
  ctx.spawned = [];
  ctx.eligibilityChecked = [];
}

// ── Hooks ───────────────────────────────────────────────────────────────────────

Before({ tags: '@adw-753' }, function () {
  resetCtx();
});

After({ tags: '@adw-753' }, function () {
  resetCtx();
});

// ── Recording deps ──────────────────────────────────────────────────────────────

function buildRecordingDeps(): DependencyUnblockDeps {
  return {
    listOpenIssues: () => ctx.issues,
    extractDependents: (body) => Promise.resolve(parseKeywordProximityDependencies(body)),
    checkEligibility: async (issueNumber) => {
      ctx.eligibilityChecked.push(issueNumber);
      return ctx.eligibilityVerdicts.get(issueNumber) ?? { eligible: true };
    },
    spawn: async (issueNumber) => {
      ctx.spawned.push(issueNumber);
    },
    logger: () => {},
  };
}

// ── Given: seeded open issues ─────────────────────────────────────────────────────

Given(
  'an open issue {int} with a prose dependency line {string} and no dependency heading',
  function (issueNumber: number, proseLine: string) {
    ctx.issues.push({ number: issueNumber, body: proseLine });
  },
);

Given(
  'an open issue {int} with no dependency on blocker {int}',
  function (issueNumber: number, _blockerNumber: number) {
    ctx.issues.push({ number: issueNumber, body: 'An unrelated open issue body with no blocker reference.' });
  },
);

Given(
  'an open issue {int} that lists blocker {int} under a Blocked by heading',
  function (issueNumber: number, blockerNumber: number) {
    ctx.issues.push({ number: issueNumber, body: `## Blocked by\n- #${blockerNumber}` });
  },
);

// ── Given: seeded eligibility verdicts ─────────────────────────────────────────────

Given(
  'the injected eligibility check reports issue {int} as eligible',
  function (issueNumber: number) {
    ctx.eligibilityVerdicts.set(issueNumber, { eligible: true });
  },
);

Given(
  'the injected eligibility check reports issue {int} as still blocked',
  function (issueNumber: number) {
    ctx.eligibilityVerdicts.set(issueNumber, { eligible: false, reason: 'open_dependencies' });
  },
);

// ── When ────────────────────────────────────────────────────────────────────────

When(
  'the issue-closed dependency unblock runs for closed issue {int}',
  async function (closedIssueNumber: number) {
    await handleIssueClosedDependencyUnblock(closedIssueNumber, ctx.repoInfo, [], undefined, buildRecordingDeps());
  },
);

// ── Then: eligibility re-evaluation spy ───────────────────────────────────────────

Then(
  'the dependency unblock re-evaluates eligibility for issue {int}',
  function (issueNumber: number) {
    assert.ok(
      ctx.eligibilityChecked.includes(issueNumber),
      `Expected eligibility to be re-evaluated for issue ${issueNumber} but it was not. Consulted: [${ctx.eligibilityChecked.join(', ')}]`,
    );
  },
);

Then(
  'the dependency unblock does not re-evaluate eligibility for issue {int}',
  function (issueNumber: number) {
    assert.ok(
      !ctx.eligibilityChecked.includes(issueNumber),
      `Expected eligibility NOT to be re-evaluated for issue ${issueNumber} but it was consulted.`,
    );
  },
);

// ── Then: spawn spy ────────────────────────────────────────────────────────────────

Then(
  'the dependency unblock spawns a workflow for issue {int}',
  function (issueNumber: number) {
    assert.ok(
      ctx.spawned.includes(issueNumber),
      `Expected a spawn for issue ${issueNumber} but recorded spawns: [${ctx.spawned.join(', ')}]`,
    );
  },
);

Then(
  'the dependency unblock spawns no workflow for issue {int}',
  function (issueNumber: number) {
    assert.ok(
      !ctx.spawned.includes(issueNumber),
      `Expected no spawn for issue ${issueNumber} but it was recorded as spawned.`,
    );
  },
);
