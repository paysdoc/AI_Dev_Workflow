/**
 * Step definitions for feature-743.feature
 *
 * Drives the production `runPromotionRotAdvisory` in-process (the injectable
 * core in adws/phases/promotionRotAdvisory.ts) with an injected, controllable
 * analysis stub and a capturing PR commenter — mirroring the old
 * `PromotionCommenterDeps.postComment` injection precedent and the
 * feature-740 / feature-739 discipline of exercising the new deep helper
 * directly, NOT an orchestrator subprocess and NOT the LLM review agent.
 * Does not stand up the mock GitHub server or a full WorkflowConfig review
 * run — the advisory is exercised as the discrete step the PRD's "Pipeline
 * modifications" describes.
 *
 * Self-contained module-private `ctx` per the feature file's step-definition
 * note — does NOT reach into feature-740.steps.ts's or feature-739.steps.ts's
 * ctx or step defs, and does NOT redefine the regression givenSteps/thenSteps
 * comment defs T2/T3/T14.
 *
 * The seeded "promoted scenario" is represented as in-memory fixture data (a
 * fixed list of three Given/When/Then phrases) fed straight to the injected
 * analysis stub — this feature's chosen seam (PromotionRotAdvisoryDeps.analyze)
 * takes only the promoted feature id, never a file path; phrase extraction
 * itself happens inside the LLM agent boundary the scenarios deliberately do
 * not drive (see feature file's Scope notes). This fixture data is INPUT the
 * step CONSUMES — not a framework source file.
 *
 * Registered phrases reused (not redefined here):
 *  - Given 'the ADW codebase is checked out'      → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts (T22)
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import {
  runPromotionRotAdvisory,
  type PromotionRotAdvisoryContext,
  type PromotionRotAdvisoryDeps,
} from '../../../adws/phases/promotionRotAdvisory.ts';
import type { RotVerdict } from '../../../adws/agents/rotAnalysisAgent.ts';

type AnalysisMode = 'success' | 'rot' | 'fail';

interface SeedPhrase {
  keyword: string;
  step: string;
}

interface PostedComment {
  prNumber: number;
  body: string;
}

interface AdvisoryCtx {
  prNumber: number;
  issueNumber: number;
  labels: { name: string }[];
  feature: string;
  phrases: SeedPhrase[];
  analysisMode: AnalysisMode;
  analysisCallCount: number;
  postedComments: PostedComment[];
  advisoryThrew: boolean;
  rotFlaggedStep: string | null;
}

const SEED_PHRASES: readonly SeedPhrase[] = [
  { keyword: 'Given', step: 'a fixture given precondition is set' },
  { keyword: 'When', step: 'the fixture action is performed' },
  { keyword: 'Then', step: 'the fixture outcome is observed' },
];

const ctx: AdvisoryCtx = {
  prNumber: 0,
  issueNumber: 0,
  labels: [],
  feature: '',
  phrases: [],
  analysisMode: 'success',
  analysisCallCount: 0,
  postedComments: [],
  advisoryThrew: false,
  rotFlaggedStep: null,
};

function resetCtx(): void {
  ctx.prNumber = 0;
  ctx.issueNumber = 0;
  ctx.labels = [];
  ctx.feature = '';
  ctx.phrases = [];
  ctx.analysisMode = 'success';
  ctx.analysisCallCount = 0;
  ctx.postedComments = [];
  ctx.advisoryThrew = false;
  ctx.rotFlaggedStep = null;
}

After({ tags: '@adw-743' }, function () {
  resetCtx();
});

/** Builds the stub analysis's verdict set: one verdict per seeded phrase, in order. */
function buildVerdicts(): RotVerdict[] {
  return ctx.phrases.map((phrase, i) => {
    const flagged = ctx.analysisMode === 'rot' && i === 0;
    if (flagged) ctx.rotFlaggedStep = phrase.step;
    return {
      step: phrase.step,
      keyword: phrase.keyword,
      reuse: `reuse-check-${i}`,
      rot: flagged ? 'ROT' : 'VALID',
      note: flagged ? 'fixture-flagged-rot' : 'fixture-ok',
    };
  });
}

// ── Given — promotion context ────────────────────────────────────────────────

Given('a regression-promotion PR {int} for issue {int} is under review, promoting a scenario carrying Given\\/When\\/Then phrases', function (prNumber: number, issueNumber: number) {
  ctx.prNumber = prNumber;
  ctx.issueNumber = issueNumber;
  ctx.labels = [{ name: 'regression-promotion' }];
  ctx.feature = `feature-${issueNumber}`;
  ctx.phrases = SEED_PHRASES.map(p => ({ ...p }));
});

Given('an ordinary PR {int} for issue {int} without the {string} label is under review', function (prNumber: number, issueNumber: number, _label: string) {
  ctx.prNumber = prNumber;
  ctx.issueNumber = issueNumber;
  ctx.labels = [{ name: 'enhancement' }];
  ctx.feature = `feature-${issueNumber}`;
  ctx.phrases = SEED_PHRASES.map(p => ({ ...p }));
});

// ── Given — injected analysis stub control ───────────────────────────────────

Given('the phrase analysis returns a reuse verdict and a rot verdict for each promoted phrase', function () {
  ctx.analysisMode = 'success';
});

Given('the phrase analysis flags a promoted phrase as vocabulary rot', function () {
  ctx.analysisMode = 'rot';
});

Given('the phrase analysis fails', function () {
  ctx.analysisMode = 'fail';
});

// ── When ──────────────────────────────────────────────────────────────────────

When('the review phase runs its promotion rot\\/reuse advisory', async function () {
  const context: PromotionRotAdvisoryContext = {
    prNumber: ctx.prNumber,
    labels: ctx.labels,
    feature: ctx.feature,
  };
  const deps: PromotionRotAdvisoryDeps = {
    analyze: async () => {
      ctx.analysisCallCount++;
      if (ctx.analysisMode === 'fail') {
        throw new Error('injected transient analysis failure');
      }
      return buildVerdicts();
    },
    postComment: (prNumber: number, body: string) => {
      ctx.postedComments.push({ prNumber, body });
    },
    log: () => { /* keep test output quiet */ },
  };

  try {
    await runPromotionRotAdvisory(context, deps);
  } catch {
    ctx.advisoryThrew = true;
  }
});

// ── Then — captured comment assertions ───────────────────────────────────────

function commentsFor(prNumber: number): PostedComment[] {
  return ctx.postedComments.filter(c => c.prNumber === prNumber);
}

function lineContaining(body: string, needle: string): string | undefined {
  return body.split('\n').find(line => line.includes(needle));
}

Then('exactly one advisory comment is posted on PR {int}', function (prNumber: number) {
  const matches = commentsFor(prNumber);
  assert.strictEqual(matches.length, 1, `Expected exactly one advisory comment on PR ${prNumber}, got ${matches.length}`);
});

Then('the advisory comment carries a reuse verdict and a rot verdict for each promoted Given\\/When\\/Then phrase', function () {
  const matches = commentsFor(ctx.prNumber);
  assert.ok(matches.length > 0, `Expected an advisory comment on PR ${ctx.prNumber} to inspect`);
  const body = matches[0].body;
  for (let i = 0; i < ctx.phrases.length; i++) {
    const phrase = ctx.phrases[i];
    const line = lineContaining(body, phrase.step);
    assert.ok(line, `Expected the comment body to carry a line for phrase "${phrase.step}". Got:\n${body}`);
    assert.ok(line!.includes(`reuse-check-${i}`), `Expected the line for "${phrase.step}" to carry a reuse verdict. Got: ${line}`);
    assert.ok(/VALID|ROT|UNKNOWN/.test(line!), `Expected the line for "${phrase.step}" to carry a rot verdict. Got: ${line}`);
  }
});

Then('the advisory comment surfaces the flagged rot verdict', function () {
  assert.ok(ctx.rotFlaggedStep, 'Expected a rot-flagged phrase to have been injected by a prior Given step');
  const matches = commentsFor(ctx.prNumber);
  assert.ok(matches.length > 0, `Expected an advisory comment on PR ${ctx.prNumber} to inspect`);
  const line = lineContaining(matches[0].body, ctx.rotFlaggedStep as string);
  assert.ok(line, `Expected the comment body to carry the flagged phrase "${ctx.rotFlaggedStep}"`);
  assert.ok(line?.includes('ROT'), `Expected the flagged phrase's line to surface the ROT verdict. Got: ${line}`);
});

Then('no advisory comment is posted on PR {int}', function (prNumber: number) {
  const matches = commentsFor(prNumber);
  assert.strictEqual(matches.length, 0, `Expected no advisory comment on PR ${prNumber}, got ${matches.length}`);
});

Then('the phrase analysis is not run', function () {
  assert.strictEqual(ctx.analysisCallCount, 0, `Expected the phrase analysis to not run, but it ran ${ctx.analysisCallCount} time(s)`);
});

Then('the promotion rot\\/reuse advisory does not block or fail the review', function () {
  assert.strictEqual(ctx.advisoryThrew, false, 'Expected the promotion rot/reuse advisory to not throw or block the review');
});

Then('the promotion rot\\/reuse advisory completes without raising an error', function () {
  assert.strictEqual(ctx.advisoryThrew, false, 'Expected the promotion rot/reuse advisory to complete without raising an error');
});
