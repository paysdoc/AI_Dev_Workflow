/**
 * BDD step definitions for feature-542.feature
 * issues.opened label-routed handler — classification driven by adw:* labels.
 *
 * Design (mirrors the feature-540 sibling pattern)
 * ------------------------------------------------
 * The issues.opened routing logic lives in `routeIssueOpened`
 * (adws/triggers/issueOpenedRouter.ts) behind a DI seam (IssueOpenedRouterDeps).
 * Driving the real webhook HTTP server — or the real classifyAndSpawnWorkflow —
 * is not viable in this harness: classifyAndSpawnWorkflow calls spawnDetached,
 * which forks a real detached `bunx tsx` orchestrator. (The regression W-steps in
 * whenSteps.ts return 'pending' for exactly this reason.) So we drive
 * routeIssueOpened in-process with recording deps and bridge the recorded
 * comment/label calls into a synthetic MockContext whose getRecordedRequests()
 * feeds the reused vocabulary assertions.
 *
 * Observability / rot-prevention: every assertion below reads a runtime artefact,
 * never the text of a source file.
 *   - comment posts / label applications → synthetic MockContext recorded requests
 *     (consumed by T2/T3/T12/T13 and feature-509's "zero comment posts" T14)
 *   - spawn + its classification         → recording classifyAndSpawn dep
 *   - whether the LLM classifier ran      → recording classifyAndSpawn dep: only the
 *     infer branch records an invocation; the label-routed branches skip it. The
 *     inferred type is read from the loaded claude-cli-stub fixture, parsed with the
 *     same regex the real classifier (classifyWithIssueCommand) uses.
 *
 * Steps reused from existing files (NOT redefined here):
 *   - Given 'the ADW codebase is checked out'                                  → ensureCronOnEveryEventSteps.ts
 *   - Given 'an issue {int} exists in the mock issue tracker'                   → givenSteps.ts (G4)
 *   - Given 'the mock GitHub API is configured to accept issue comments'        → givenSteps.ts (G1)
 *   - Given 'the mock GitHub API is configured to accept label applications'    → givenSteps.ts (G12)
 *   - Given 'the claude-cli-stub is loaded with fixture {string}'               → givenSteps.ts (G9)
 *   - Then  'the mock GitHub API recorded a comment on issue {int}'             → thenSteps.ts (T2)
 *   - Then  'the mock GitHub API recorded a comment containing the text {string}' → thenSteps.ts (T3)
 *   - Then  'the mock GitHub API recorded an application of the {string} label on issue {int}' → thenSteps.ts (T12)
 *   - Then  'the mock harness recorded zero applications of the {string} label on issue {int}' → thenSteps.ts (T13)
 *   - Then  'the mock harness recorded zero comment posts on issue {int}'       → feature-509.steps.ts (T14)
 *   - Then  'the ADW TypeScript type-check passes'                              → feature-504.steps.ts
 */

import { Before, After, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import {
  routeIssueOpened,
  type IssueOpenedRouterDeps,
  type IssueOpenedOutcome,
} from '../../../adws/triggers/issueOpenedRouter.ts';
import { VALID_ISSUE_TYPES } from '../../../adws/types/issueTypes.ts';
import { isAdwComment } from '../../../adws/core/workflowCommentParsing.ts';
import type { RepoInfo } from '../../../adws/github/githubApi.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { MockContext, RecordedRequest } from '../../../test/mocks/types.ts';

// ── Per-scenario state ──────────────────────────────────────────────────────────

interface Ctx542 {
  repoInfo: RepoInfo;
  /** Synthetic GitHub API requests (comment posts + label applications). */
  recordedRequests: RecordedRequest[];
  /** Orchestrator spawns recorded by the classifyAndSpawn dep. */
  spawns: Array<{ issueNumber: number; classification: string }>;
  /** Issue numbers for which the LLM classifier (infer branch) ran. */
  classifierInvocations: number[];
  lastOutcome: IssueOpenedOutcome | null;
}

const ctx: Ctx542 = {
  repoInfo: { owner: 'test-owner', repo: 'test-repo' },
  recordedRequests: [],
  spawns: [],
  classifierInvocations: [],
  lastOutcome: null,
};

function resetCtx(): void {
  ctx.repoInfo = { owner: 'test-owner', repo: 'test-repo' };
  ctx.recordedRequests = [];
  ctx.spawns = [];
  ctx.classifierInvocations = [];
  ctx.lastOutcome = null;
}

// ── Synthetic MockContext ───────────────────────────────────────────────────────
//
// Bridges the recording deps' captured comment/label calls into the RecordedRequest
// shape that vocabulary steps G4/G1/G12 and assertions T2/T3/T12/T13/T14 expect, so
// those steps work without a real HTTP server (same approach as feature-540).

function createSyntheticMockContext(): MockContext {
  return {
    serverUrl: 'http://localhost:0',
    port: 0,
    getRecordedRequests: (): RecordedRequest[] => ctx.recordedRequests,
    setState: async () => {},
    teardown: async () => {},
  };
}

// ── Hooks ───────────────────────────────────────────────────────────────────────

Before({ tags: '@adw-542' }, function (this: RegressionWorld) {
  resetCtx();
  this.mockContext = createSyntheticMockContext();
});

After({ tags: '@adw-542' }, function (this: RegressionWorld) {
  resetCtx();
  this.mockContext = null;
  this.harnessEnv = {};
});

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Strips a leading slash from an issue-type slash command: '/bug' → 'bug'. */
function stripSlash(slashCommand: string): string {
  return slashCommand.replace(/^\//, '');
}

function recordComment(issueNumber: number, body: string): void {
  ctx.recordedRequests.push({
    method: 'POST',
    url: `/repos/${ctx.repoInfo.owner}/${ctx.repoInfo.repo}/issues/${issueNumber}/comments`,
    headers: {},
    body: JSON.stringify({ body }),
    timestamp: new Date().toISOString(),
  });
}

function recordLabelApplication(issueNumber: number, label: string): void {
  ctx.recordedRequests.push({
    method: 'POST',
    url: `/repos/${ctx.repoInfo.owner}/${ctx.repoInfo.repo}/issues/${issueNumber}/labels`,
    headers: {},
    body: JSON.stringify({ labels: [label] }),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Resolves the type the LLM classifier would infer on the infer branch by reading
 * the claude-cli-stub fixture loaded via G9 (MOCK_FIXTURE_PATH) and parsing it with
 * the same last-match regex classifyWithIssueCommand uses. Falls back to the fixture
 * basename (classify-as-<type>) and finally to 'feature'.
 */
function inferTypeFromFixture(world: RegressionWorld): string {
  const fixturePath = world.harnessEnv['MOCK_FIXTURE_PATH'];
  if (fixturePath && existsSync(fixturePath)) {
    try {
      const payload = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Array<{ type: string; text?: string }>;
      const text = payload.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      const pattern = VALID_ISSUE_TYPES.map((c) => c.replace('/', '\\/')).join('|');
      const re = new RegExp(`(${pattern})(?!.*(?:${pattern}))`, 's');
      const match = text.match(re);
      if (match) return stripSlash(match[1]);
    } catch {
      /* fall through to basename / default */
    }
    const nameMatch = fixturePath.match(/classify-as-([a-z_]+)\./);
    if (nameMatch) return nameMatch[1];
  }
  return 'feature';
}

/**
 * Recording IssueOpenedRouterDeps. Mirrors the observable behaviour of the production
 * deps (classifyAndSpawnWorkflow / commentOnIssue) without any real side effects:
 *  - label-routed (precomputedClassification): spawn only — no classifier, no re-apply
 *    of the label the user already attached.
 *  - infer (persistInferredLabel): classifier runs, the inferred adw:<type> label is
 *    applied, then the orchestrator spawns.
 */
function buildRecordingDeps(world: RegressionWorld): IssueOpenedRouterDeps {
  return {
    checkEligibility: async () => ({ eligible: true }),
    classifyAndSpawn: async (issueNumber, _repoInfo, _targetRepoArgs, labelRouting) => {
      if (labelRouting?.precomputedClassification) {
        ctx.spawns.push({ issueNumber, classification: stripSlash(labelRouting.precomputedClassification) });
        return;
      }
      ctx.classifierInvocations.push(issueNumber);
      const inferredType = inferTypeFromFixture(world);
      if (labelRouting?.persistInferredLabel) {
        recordLabelApplication(issueNumber, `adw:${inferredType}`);
      }
      ctx.spawns.push({ issueNumber, classification: inferredType });
    },
    postComment: (issueNumber, body) => recordComment(issueNumber, body),
    logger: () => {},
  };
}

// ── When ────────────────────────────────────────────────────────────────────────

When(
  'the webhook handler receives a {string} event for issue {int} carrying labels {string}',
  async function (this: RegressionWorld, eventType: string, issueNumber: number, labelsCsv: string) {
    const labelNames = labelsCsv.split(',').map((s) => s.trim()).filter(Boolean);

    // Only issues.opened is subscribed. A `labeled` event is ignored by the handler
    // (the CRON layer rescans later), so no routing — and therefore no artefacts — occur.
    if (eventType !== 'opened') return;

    ctx.lastOutcome = await routeIssueOpened(
      {
        issueNumber,
        issueBody: '',
        issueTitle: `Issue ${issueNumber}`,
        labelNames,
        repoInfo: ctx.repoInfo,
        targetRepoArgs: [],
      },
      buildRecordingDeps(this),
    );
  },
);

// ── Then: spawn assertions ────────────────────────────────────────────────────────

Then(
  'the webhook spawned no orchestrator for issue {int}',
  function (issueNumber: number) {
    const spawned = ctx.spawns.filter((s) => s.issueNumber === issueNumber);
    assert.strictEqual(
      spawned.length,
      0,
      `Expected no orchestrator spawn for issue ${issueNumber} but recorded ${spawned.length}: ${JSON.stringify(spawned)}`,
    );
  },
);

Then(
  'the webhook spawned an orchestrator for issue {int} classified as {string}',
  function (issueNumber: number, expectedClassification: string) {
    const spawned = ctx.spawns.filter((s) => s.issueNumber === issueNumber);
    assert.ok(
      spawned.length > 0,
      `Expected an orchestrator spawn for issue ${issueNumber} but none was recorded`,
    );
    const match = spawned.find((s) => s.classification === expectedClassification);
    assert.ok(
      match,
      `Expected a spawn for issue ${issueNumber} classified as "${expectedClassification}" but recorded: [${spawned.map((s) => s.classification).join(', ')}]`,
    );
  },
);

// ── Then: classifier-invocation assertions ────────────────────────────────────────

Then(
  'the claude classifier was invoked for issue {int}',
  function (issueNumber: number) {
    assert.ok(
      ctx.classifierInvocations.includes(issueNumber),
      `Expected the claude classifier to be invoked for issue ${issueNumber} but it was not. Invocations: [${ctx.classifierInvocations.join(', ')}]`,
    );
  },
);

Then(
  'the claude classifier was not invoked for issue {int}',
  function (issueNumber: number) {
    assert.ok(
      !ctx.classifierInvocations.includes(issueNumber),
      `Expected the claude classifier NOT to be invoked for issue ${issueNumber} but it was. Invocations: [${ctx.classifierInvocations.join(', ')}]`,
    );
  },
);

// ── Then: comment-marker assertion ────────────────────────────────────────────────

Then(
  'the recorded comment on issue {int} carries no ADW workflow marker',
  function (this: RegressionWorld, issueNumber: number) {
    const requests = this.getRecordedRequests();
    const comments = requests.filter(
      (r: RecordedRequest) => r.method === 'POST' && r.url.includes(`/issues/${issueNumber}/comments`),
    );
    assert.ok(
      comments.length > 0,
      `Expected a recorded comment on issue ${issueNumber} but none was found`,
    );
    for (const r of comments) {
      let body = '';
      try {
        body = (JSON.parse(r.body) as { body?: string }).body ?? '';
      } catch {
        body = r.body;
      }
      assert.ok(
        !isAdwComment(body),
        `Expected the comment on issue ${issueNumber} to carry no ADW workflow marker (## :emoji: heading or <!-- adw-bot --> signature), but it does:\n${body}`,
      );
    }
  },
);
