# Promotion System

## Overview

The promotion system carries a per-issue BDD scenario in `features/per-issue/feature-N.feature` from scoring through tag-state tracking, an automated cron sweep, and a human-reviewed advisory comment, until it is manually relocated into `features/regression/`. `adws/promotion/` is the pure scoring library that parses `.feature` files and the vocabulary registry and scores scenarios against a deterministic, auto-ramping threshold; `adws/core/promotionTagState.ts` tracks each file's on-disk promotion marker; `adws/triggers/promotionSweep.ts` and its decider/reconcile/issue-body/defaults helpers form the automated sweep that originates, declines, redrives, or withdraws promotion candidates and reconciles them against their tracking issues; and `adws/phases/promotionRotAdvisory.ts` posts a non-blocking rot/reuse advisory comment once a promotion issue reaches a PR. The sweep never performs the `features/per-issue/` → `features/regression/` relocation itself — that step is done by hand, or by the normal SDLC pipeline once the promotion issue it files is picked up.

## Responsibilities

**Scoring (`adws/promotion/`)**

- Parse `.feature` file content into typed `Scenario` objects (tags, steps, line positions) using the Cucumber Gherkin parser via `scenarioParser.ts`.
- Parse the vocabulary registry markdown from `features/regression/vocabulary.md` via `vocabularyParser.ts`.
- Score each scenario against the `VocabularyRegistry` via `promotionScorer.ts`, producing a `ScoreResult` with a numeric total and a breakdown across three dimensions: `surfaceMatch`, `executionPattern`, and `phaseCount`.
- Compute the dynamic promotion threshold via `promotionThreshold.ts` based on rolling 90-day stats: bootstraps at 3 when no history exists and ramps linearly up to 7 as the promoted-to-total ratio approaches 50%.
- Load promotion stats (90-day promoted count and per-issue scenario count) via `promotionStatsLoader.ts`, derived from `git log` queries (`regression-promotion:` commit-message grep for the numerator, `+ Scenario:` diff lines under the per-issue glob for the denominator).
- Re-export the scoring/threshold/parsing surface through `adws/promotion/index.ts` for consumers like `promotionSweep.ts`.

**Tag state (`adws/core/promotionTagState.ts`)**

- `parsePromotionTagState(content)`: reads a feature file's full text and returns its promotion state (`'none' | 'suggested' | 'declined'`), considering only Gherkin tag lines (a line where every whitespace-separated token starts with `@`) anywhere in the file — feature-level or scenario-level, placement-agnostic.
- `serializePromotionTagState(content, target, opts)`: applies a target state to the feature-level tag line (the tag line directly above `Feature:`, created if absent, matching its indentation) idempotently — adds/replaces/strips the marker while preserving every non-marker token (e.g. `@adw-N`) and all other file bytes.
- `isPromotionExempt(state)`: the pure exemption predicate — `true` only for `'suggested'`; `'declined'` and `'none'` are not exempt. Consumed by the 14-day per-issue scenario sweep (see `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`) to decide whether a stale scenario is exempt from deletion.

**Sweep lifecycle (`adws/triggers/promotionSweep.ts` + helpers)**

- `runPromotionSweep(deps)` — the non-fatal, dependency-injected imperative shell (mirrors `runPerIssueScenarioSweep`). `PromotionSweepDeps.boundary` is a **required** `LaunchBoundary` field; the shell builds its production defaults once via `makeDefaultDeps(deps.boundary)`, lists tracked per-issue files, scores each via the scorer/threshold above, reconciles against an ALL-STATE `regression-promotion` issue listing, calls the decider, and routes to the matching executor (`attemptOriginate`, `attemptRedrive`, `attemptTagWrite` for decline/withdraw). It performs no repo-identity resolution of its own, and is both hand-invokable (`bunx tsx adws/triggers/promotionSweep.ts [--target-repo owner/repo]`) and live in the cron loop via `runPromotionSweepTick`.
- `decidePromotionAction(input)` (`adws/core/promotionSweepDecider.ts`) — pure lifecycle decider mapping `{ tagState, meetsThreshold, reconcile }` to a single `PromotionAction`: `originate | leave | done | decline | redrive | withdraw`.
- `parsePromotesMarker` / `reconcilePromotionLink` / `reconcileFactFor` (`adws/core/promotionReconcileLink.ts`) — pure matcher that parses the `Promotes: feature-N` back-link line from a promotion issue's body, links a `feature-N` id to its canonical tracking issue (lowest-issue-number tie-break across ALL states), and classifies that tracker into the full `ReconcileFact` union: `no-issue | open | closed-unmerged | blocked` (`merged` is a defensive/forward-compat value only — see Gotchas).
- `buildPromotionIssue(input)` (`adws/core/promotionIssueBody.ts`) — pure builder producing the `{ title, body, labels }` for the promotion issue: a `Promotes: feature-N` marker line, a #734-shaped relocation instruction (`git mv` of the feature + step-def files, add `@regression`, register phrases in the vocabulary registry, prove `@regression` green), and the fixed label set `['adw:feature', 'regression-promotion', 'hitl']`. Reused verbatim by both the `originate` and `redrive` executors.
- `makeDefaultDeps(boundary)` (`adws/triggers/promotionSweepDefaults.ts`) — factory closing all nine production dependency implementations over the single passed `LaunchBoundary`: git-backed helpers (`listPerIssueFeatures`, `readFeatureContent`, `listStepDefSiblings`, `scenariosConfig`, `loadVocabulary`, `loadStats`, `tagAndCommit`) read/write via `boundary.gitContext`, while `listPromotionIssues` and `fileIssue` call `boundary.providers.issueTracker`, and `tagAndCommit` reads the default branch via `boundary.providers.codeHost.getDefaultBranch()`. Split out to keep `promotionSweep.ts` under the file-length guideline.
- `listPromotionIssues` calls `issueTracker.listIssues({ fields: ['number', 'body', 'state', 'labels'], state: 'all', search: 'label:"regression-promotion"', limit: 200 })` — the all-state query is what lets the reconcile classifier distinguish a closed/blocked tracker from a genuinely missing one.
- `fileIssue` calls `issueTracker.createIssue(spec.title, spec.body)`, which returns the new issue number directly, then applies every label in `spec.labels` via `issueTracker.applyLabel(issueNumber, label)`.
- `runPromotionSweepTick(cycleCount, sweep?)` (`adws/triggers/trigger_cron.ts`) — the cron dispatch seam: on a cadence-eligible cycle (`cycleCount % PROMOTION_SWEEP_INTERVAL_CYCLES === 0`) it invokes the sweep inside a try/catch that logs and swallows any throw (including a transient git/gh failure during the sweep's un-guarded context setup). Off-cadence cycles are a no-op. `sweep` defaults to a bound thunk over the cron's own launch boundary (`boundPromotionSweep()`); when no launch boundary is available, the tick logs a warning and skips the pass instead of falling back to a cwd-derived identity. Called unconditionally every tick from `checkAndTrigger`, immediately after `runPerIssueScenarioSweepTick`.

**Rot/reuse advisory (`adws/phases/promotionRotAdvisory.ts` + helpers)**

- `hasRegressionPromotionLabel(labels)` (`adws/github/labelManager.ts`) — pure predicate gating the whole step on the driving issue carrying the `regression-promotion` label (`ADW_REGRESSION_PROMOTION_LABEL`).
- `runRotAnalysisAgent(feature, options)` / `extractRotVerdicts(output)` (`adws/agents/rotAnalysisAgent.ts`) — wraps the `/promote_regression_vocabulary` slash command via `runCommandAgent`, returning a `RotVerdict[]` (`{ step, keyword, reuse, rot, note }`). Tolerates fenced/prose-wrapped JSON output and coerces any out-of-range `rot` value to `'UNKNOWN'` rather than failing.
- `formatRotAdvisoryComment(feature, verdicts)` (`adws/phases/rotAdvisoryFormat.ts`) — pure Markdown formatter: an advisory/non-blocking header plus a `| Step | Reuse | Rot | Note |` table, with a stable "no phrases analysed" fallback line for an empty verdict list.
- `runPromotionRotAdvisory(context, deps)` / `executePromotionRotAdvisory(config)` (`adws/phases/promotionRotAdvisory.ts`, re-exported from `adws/phases/reviewPhase.ts`) — the orchestration: gates on the label, resolves the PR number and the promoted `feature-N` id (via `parsePromotesMarker` on the issue body), runs the analysis agent in the worktree, formats one comment, and posts it via `repoContext.codeHost.commentOnPullRequest`.
- `.claude/commands/promote_regression_vocabulary.md` — the slash-command prompt that delegates to the `promote-regression-vocabulary` skill and constrains output to a bare JSON array (no prose, no edits).

## Contracts & Invariants

**Scoring**

- `promotionScorer.score` awards `surfaceMatch` (weight 3) only when every step matches a vocabulary phrase AND every matched assertion target appears in the `examplesBlock` — both conditions must hold simultaneously.
- `executionPattern` weight is 3 for `subprocess`, 2 for `phase-import`, and 0 for `mock-query`; only the highest-weight `When` pattern is counted.
- `phaseCount` is `(whenStepCount - 1) * 1` when there are two or more `When`/`And-after-When` steps, else 0.
- The maximum achievable score is 7 (3 surfaceMatch + 3 subprocess + 1 phaseCount for a two-phase scenario), which also equals `MAX_THRESHOLD` — the highest possible threshold.
- `computeThreshold` returns `BOOTSTRAP_THRESHOLD` (3) when `totalPerIssueCount90d` is 0.
- Step phrase matching is case-sensitive but `{string}` and `{int}` wildcards are treated as regex wildcards (`.*` and `\d+`; longest phrase wins on overlap).
- `loadPromotionStats` fails safe: a failed `git log` query (numerator or denominator) is logged and treated as 0, never thrown.
- This sub-module only scores and parses; it does not tag files, file issues, or move scenarios — tagging, sweep decisions, and issue-filing are handled by the tag-state and sweep-lifecycle responsibilities documented below, kept in separate files for testability.

**Tag state**

- No I/O in `promotionTagState.ts`: every function takes a string and returns a new string/value; nothing is mutated, nothing touches disk, git, or gh.
- `declined` is terminal and wins over a lingering `suggested` marker if both are present on the same file (a malformed/partially-written file resumes the normal TTL rather than being exempt forever) — matches "rejecting a promotion is durable."
- Only tag *lines* are matched (exact-token equality against `@promotion-declined` / the dated regex `^@promotion-suggested-\d{4}-\d{2}-\d{2}$`), never prose — a Feature description or step that merely mentions a marker as literal text is not parsed as a tag.
- `serializePromotionTagState` is idempotent: re-applying the same target (same `opts.date` for `'suggested'`) yields byte-identical output, and round-trips (`parsePromotionTagState(serializePromotionTagState(c, s, opts)) === s`).
- `target: 'suggested'` requires `opts.date` (`YYYY-MM-DD`) and throws if omitted.
- If the file has no `Feature:` line at all, `serializePromotionTagState` returns the content unchanged (no-op).
- An undated `@promotion-suggested` (missing `-YYYY-MM-DD`) does not match the dated regex and parses as `'none'` (not exempt) — only a properly dated suggestion protects a file from the sweep.
- Both sides of this module are live in production: `parsePromotionTagState` and `isPromotionExempt` are read by `perIssueScenarioSweep.ts` (the 14-day sweep's exemption check), and `serializePromotionTagState` is written by the promotion sweep below (`tagAndCommit`, via the `originate`/`redrive`/`decline`/`withdraw` executors).

**Sweep lifecycle**

- `decidePromotionAction` is pure and total over its full input cross-product (`{tagState} × {meetsThreshold} × {reconcile}`):

  | tagState  | meetsThreshold | reconcile            | action    |
  |-----------|----------------|-----------------------|-----------|
  | any       | any            | merged                | done      |
  | none      | true           | no-issue              | originate |
  | none      | false          | no-issue              | leave     |
  | none      | any            | open/closed/blocked   | leave     |
  | suggested | any            | open                  | leave     |
  | suggested | any            | closed-unmerged       | decline   |
  | suggested | any            | blocked               | decline   |
  | suggested | true           | no-issue              | redrive   |
  | suggested | false          | no-issue              | withdraw  |
  | declined  | any            | (non-merged)          | leave     |

  `merged` wins over every other input.
- The `reconcile` classifier checks the `adw:blocked` label **before** open/closed state, so an open-but-blocked tracker classifies `blocked` (decline), not `open` (leave).
- Origination and reconcile writes are idempotent: `serializePromotionTagState(content, target, opts)` is byte-idempotent for the same target/date, and `GitContext.addAndCommitPaths` no-ops (returns `false`, no commit) when nothing is staged for the given path.
- `runPromotionSweep` never throws in normal operation: each candidate's decode/score/action step is wrapped so a parse failure, unreadable file, or transient git/gh error during any executor (`attemptOriginate`, `attemptRedrive`, `attemptTagWrite`) is logged (`warn`) and swallowed — the loop continues to the next file and the sweep still returns a `PromotionSweepReport` (`{ originated, redriven, declined, withdrawn, left }`).
- Every mutating commit is **scoped** to exactly the candidate's feature-file path (`GitContext.addAndCommitPaths`, never `commitChanges`'s `git add -A`), so unrelated dirty state on the host is never swept in.
- `tagAndCommit` only mutates when the checkout is on the default branch (`ctx.getCurrentBranch() === boundary.providers.codeHost.getDefaultBranch()`); off-branch is a logged no-op, not an error.
- `decline` writes the terminal `@promotion-declined` marker and never mutates the tracking issue (a blocked or closed-unmerged tracker is left exactly as-is).
- `withdraw` strips the tag back to `none`, resuming TTL (`isPromotionExempt` returns `false` for `none`/`declined`), so a stranded, no-longer-qualifying candidate ages out via the sibling `perIssueScenarioSweep` instead of being re-promoted.
- A merged promotion (file already `git mv`-ed out of `features/per-issue/`) is structurally `done` — it is simply absent from `listPerIssueFeatures()` and never reprocessed. The decider's `reconcile === 'merged'` branch is a forward-compat/defensive hook, unit-tested but unreachable from the shell.
- `promotionIssueBody` and the `runPromotionSweep` shell are integration/BDD-covered (`@adw-740`, `@adw-741`), not unit-tested against git/gh mocks; `promotionSweepDecider` and `promotionReconcileLink` are pure and exhaustively unit-tested instead.

**Rot/reuse advisory**

- Never throws and never blocks: `executePromotionRotAdvisory` always returns a valid zero/low-cost `PhaseCostRecord[]` regardless of outcome, and `adwSdlc.tsx` does not branch on its result.
- A non-promotion workflow (issue lacks `regression-promotion`) posts no comment and incurs no analysis cost — the label gate short-circuits before any I/O.
- At most one comment is posted per run: `runPromotionRotAdvisory` posts exactly once, after the label gate, agent run, and format all succeed.
- Any failure once gated — no PR number, no `Promotes:` marker, agent throw/timeout, `OutputValidationError` from the retry loop, or a `commentOnPullRequest` error — degrades to a logged `warn` and the workflow continues; no comment is posted for that failure path.
- Wired **after** `executePRPhase` in `adwSdlc.tsx` (adjacent to `executeProofPublishPhase`), not inside `executeReviewPhase` — `ctx.prUrl`/`ctx.prNumber` do not exist until the PR is created, so running any earlier would have nothing to comment on.
- `extractRotVerdicts` is total: malformed entries fail extraction (triggering the agent's retry loop), but a recognized-shape entry with an unrecognized `rot` string coerces to `'UNKNOWN'` instead of failing the whole batch.
- This advisory step is independent of the sweep's `originate` path and the tag-state module above — it only runs once a promotion issue has already flowed through the normal SDLC pipeline to a PR.

## Configuration

- The scorer reads the vocabulary registry from `features/regression/vocabulary.md`. The threshold computation reads rolling 90-day stats supplied by `promotionStatsLoader` (injected `gitLogSince`, `now`, and `perIssueGlob` deps). No static configuration file for score weights; they are module-level constants in `promotionScorer.ts`.
- Tag-state parsing/serialization is pure string logic with no environment variables or config files of its own.
- `PromotionSweepDeps`: `boundary` (`LaunchBoundary`) is **required, first field, no default**; every other field (`now`, `listPerIssueFeatures`, `readFeatureContent`, `listStepDefSiblings`, `loadVocabulary`, `loadStats`, `listPromotionIssues`, `scenariosConfig`, `tagAndCommit`, `fileIssue`, `log`) stays optional, falling back to the `makeDefaultDeps(deps.boundary)` closures.
- `scenariosConfig` (`ScenariosPaths`) resolves from `loadProjectConfig(basePath).scenarios`, defaulting to `features/per-issue/` (per-issue dir), `features/regression/` (destination dir), and `features/regression/vocabulary.md` (vocabulary registry) when a target repo hasn't declared these in `.adw/scenarios.md`.
- CLI entry point: `bunx tsx adws/triggers/promotionSweep.ts` (guarded by `process.argv[1]` containing `promotionSweep`, not `import.meta.main` — `tsx` runs under Node, where that Bun-only global is `undefined`).
- `PROMOTION_SWEEP_INTERVAL_CYCLES` (`adws/core/config.ts`, barrel-exported from `adws/core/index.ts`) — cron cadence gate consumed by `runPromotionSweepTick`. Defaults to `4320` (≈ once per day at the 20s `POLL_INTERVAL_MS` poll), overridable via the env var of the same name; a non-numeric override falls through `parseInt` to `NaN` like its siblings (no bespoke validation).
- The rot/reuse advisory is routed through the standard three `SlashCommand` touch-points (`adws/types/issueTypes.ts`, and all three `Record<SlashCommand, …>` maps in `adws/core/modelRouting.ts`): `/promote_regression_vocabulary` runs on `sonnet` (`haiku` in fast mode) at `medium` reasoning effort. It introduces no new environment variables or `.adw/` config — detection is entirely in-memory off `config.issue.labels`.

## Gotchas

- `promotionScorer` sorts phrases by descending length before matching so that more-specific phrases take priority over shorter overlapping ones.
- `RATIO_CAP` is 0.5 — once more than half of per-issue scenarios from the last 90 days have been promoted, the threshold is pinned at `MAX_THRESHOLD` (7) regardless of further increases in the ratio.
- `runPromotionSweep` is live in the cron loop (via `runPromotionSweepTick`, gated at `PROMOTION_SWEEP_INTERVAL_CYCLES` ≈ once/day) — it runs against the live repo (real commits/issue filings) once eligible. It is still never invoked from `bun run test:unit` or any CI validation step; the sweep's own unit/BDD coverage exercises the pure deciders and the dispatch seam (`runPromotionSweepTick`) with an injected `sweep`, not the real `runPromotionSweep` against real git/gh.
- On cron start `cycleCount` begins at 0 and increments to 1 on the first tick, so the first cron-driven sweep fires at `cycleCount === PROMOTION_SWEEP_INTERVAL_CYCLES` (≈24h later), identical to the sibling per-issue sweep. For immediate go-live backlog processing (re-scoring `@promotion-suggested-*` files already on disk), the operator runs the manual CLI once rather than waiting for the first cadence-eligible cycle.
- `ADW_REGRESSION_PROMOTION_LABEL = 'regression-promotion'` (`adws/github/labelManager.ts`) is deliberately kept out of `ADW_CLASSIFICATION_LABELS` (must stay invisible to `LABEL_TO_COMMAND` routing) and out of `ADW_LABEL_DEFINITIONS` (keeps `ensureAdwLabelsExist`'s six-label `N/6` loop unchanged); it resolves only via `resolveLabelDefinition`'s widened lookup array (`REGRESSION_PROMOTION_LABEL_DEFINITION`), for lazy-create. Both the sweep's issue-filing (`fileIssue`) and the rot advisory's label gate (`hasRegressionPromotionLabel`) depend on this same constant.
- `GitContext.addAndCommitPaths` / `commitOps.addAndCommitPaths` is a scoped modify-and-commit primitive (the counterpart to the existing `removeAndCommitPaths`) — required to honour "never `git add -A`". It is purely additive to `commitOps.ts`/`gitContext.ts` and does not touch the upgrade-regen `excludePaths` code path.
- A promotion issue carries zero `@adw-{promotionIssueN}` BDD scenarios of its own — the pipeline stays green only because `@adw-{issueNumber}` remains `optional: true` in the review-proof defaults.
- `reconcilePromotionLink`'s tie-break (lowest issue number wins when multiple trackers promote the same `feature-N`, e.g. a redrive filing a second one) is deterministic and state-agnostic — it picks the canonical tracker regardless of whether it's open, closed, or blocked.
- `merged`/`done` remain in the `PromotionAction`/`ReconcileFact` type surface and the decider's exhaustive unit tests for a stable contract, but stay deliberately **shell-unreachable**: "done" is realized by a merged file's absence from `listPerIssueFeatures()`, not by a reconcile fact. Decline is deliberately **not** gated on the tracking issue's `stateReason` (e.g. `COMPLETED`) — that would let a "closed as completed but not merged" issue masquerade as done and strand its still-present source file, which is strictly worse than declining it.
- Distinguishing `decline` from `redrive`/`withdraw` hinges entirely on the all-state issue listing: a **closed** tracker → `closed-unmerged` (durable rejection, decline); a **missing** tracker → `no-issue` (crash-stranded, redrive-if-qualifying or withdraw-if-not). Without the all-state query both look identical.
- The reconciliation listing caps at `limit: 200`; if promotion issues ever exceed that, a real tracker could be missed → false `no-issue` → a spurious redrive (duplicate issue). Pagination is out of scope.
- `boundary` is a **required, not optional** field on `PromotionSweepDeps` — a fixed `{owner, repo}` identity is resolved exactly once at the launch boundary and threaded through both the git and forge sides of every default; there is no cwd-derived or independently-re-resolved fallback. `runPromotionSweepTick` skips the pass entirely (rather than deriving one) when no launch boundary is available.
- Rot-advisory detection keys off the **issue** label, not a PR-label fetch: there is no helper that reads labels for an arbitrary PR by number, and promotion PRs are not guaranteed to inherit the label themselves. The driving issue (labelled by `buildPromotionIssue`) always carries `regression-promotion`, and it is already in memory on `config.issue`.
- The rot-advisory function lives in two files: pure orchestration (`runPromotionRotAdvisory`, injectable deps, no direct GitHub/agent I/O) in `adws/phases/promotionRotAdvisory.ts`, and the `WorkflowConfig`-level adapter (`executePromotionRotAdvisory`) in the same file, re-exported from `adws/phases/reviewPhase.ts` to keep that file under its line-count guideline while still living at the issue's named touched file.
- A resumed run posting a second, duplicate advisory comment is accepted behavior (advisory, non-blocking) — no worse than the existing `executeProofPublishPhase` duplicate-comment tolerance on resume.
