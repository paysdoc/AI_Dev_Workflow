# Promotion Sweep — Full Reconcile Lifecycle

## Overview

This module is the automated scenario-promotion sweep: `runPromotionSweep()` scores tracked `features/per-issue/feature-N.feature` files with the existing deterministic scorer/threshold, and drives each file through its full lifecycle — `originate` a fresh high scorer, then reconcile an already-`@promotion-suggested-*` file against its tracking issue/PR to `decline`, `redrive`, or `withdraw`. It never performs the relocation itself — that is done by the normal SDLC pipeline once the promotion issue is picked up (the pattern proven by hand in issue #734). It is both hand-invokable (`bunx tsx adws/triggers/promotionSweep.ts`, for immediate/backlog runs) and live in the cron loop, dispatched on a generous interval gate via `runPromotionSweepTick`.

## Responsibilities

- `decidePromotionAction(input)` (`adws/core/promotionSweepDecider.ts`) — pure lifecycle decider mapping `{ tagState, meetsThreshold, reconcile }` to a single `PromotionAction`: `originate | leave | done | decline | redrive | withdraw`.
- `parsePromotesMarker` / `reconcilePromotionLink` / `reconcileFactFor` (`adws/core/promotionReconcileLink.ts`) — pure matcher that parses the `Promotes: feature-N` back-link line from a promotion issue's body, links a `feature-N` id to its canonical tracking issue (lowest-issue-number tie-break across ALL states), and classifies that tracker into the full `ReconcileFact` union: `no-issue | open | closed-unmerged | blocked` (`merged` is never produced here — see Gotchas).
- `buildPromotionIssue(input)` (`adws/core/promotionIssueBody.ts`) — pure builder that produces the `{ title, body, labels }` for the promotion issue: a `Promotes: feature-N` marker line, a #734-shaped relocation instruction (`git mv` of the feature + step-def files, add `@regression`, register phrases in the vocabulary registry, prove `@regression` green), and the fixed label set `['adw:feature', 'regression-promotion', 'hitl']`. Reused verbatim by both the `originate` and `redrive` executors.
- `runPromotionSweep(deps)` (`adws/triggers/promotionSweep.ts`) — the non-fatal, dependency-injected imperative shell. Mirrors `runPerIssueScenarioSweep`: lists tracked per-issue files, scores each via the reused scorer/threshold, reconciles against an ALL-STATE `regression-promotion` issue listing, calls the decider, and routes to the matching executor.
- `adws/triggers/promotionSweepDefaults.ts` — the production dependency implementations (`GitContext` + `loadProjectConfig` + `fs`-backed) that `PromotionSweepDeps` falls back to when no override is injected; split out to keep `promotionSweep.ts` under the file-length guideline.
- `adws/gitContext/commands/issueCommands.ts` (`listOpenIssuesCmd`) — the `gh issue list` command builder consumed via `GitContext.listOpenIssues`; the reconcile path calls it with `state: 'all'` so it can see closed and blocked trackers (every other caller keeps the default `state: 'open'`).
- `runPromotionSweepTick(cycleCount, sweep = runPromotionSweep)` (`adws/triggers/trigger_cron.ts`) — the cron dispatch seam: on a cadence-eligible cycle (`cycleCount % PROMOTION_SWEEP_INTERVAL_CYCLES === 0`) it invokes the sweep inside a try/catch that logs and swallows any throw (including a transient git/gh failure during the sweep's un-guarded context setup — the reconciliation query, vocab/stats loads). Off-cadence cycles are a no-op. Called unconditionally every tick from `checkAndTrigger` (immediately after the per-issue scenario sweep block); the gate and swallow both live inside the seam, not the call site. Exported (with an injectable `sweep`) so both the cadence decision and the swallow guarantee are testable, mirroring the `runHungDetectorSweep` export precedent.

## Contracts & Invariants

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
- `tagAndCommit` only mutates when the checkout is on the default branch (`ctx.getCurrentBranch() === ctx.defaultBranch()`); off-branch is a logged no-op, not an error.
- `decline` writes the terminal `@promotion-declined` marker and never mutates the tracking issue (a blocked or closed-unmerged tracker is left exactly as-is).
- `withdraw` strips the tag back to `none`, resuming TTL (`isPromotionExempt` returns `false` for `none`/`declined`), so a stranded, no-longer-qualifying candidate ages out via the sibling `perIssueScenarioSweep` instead of being re-promoted.
- A merged promotion (file already `git mv`-ed out of `features/per-issue/`) is structurally `done` — it is simply absent from `listPerIssueFeatures()` and never reprocessed. The decider's `reconcile === 'merged'` branch is a forward-compat/defensive hook, unit-tested but unreachable from the shell.
- `promotionIssueBody` and the `runPromotionSweep` shell are integration/BDD-covered (`@adw-740`, `@adw-741`), not unit-tested against git/gh mocks; `promotionSweepDecider` and `promotionReconcileLink` are pure and exhaustively unit-tested instead.

## Configuration

- `PromotionSweepDeps` (all optional, production defaults from `promotionSweepDefaults.ts`): `now`, `listPerIssueFeatures`, `readFeatureContent`, `listStepDefSiblings`, `loadVocabulary`, `loadStats`, `listPromotionIssues`, `scenariosConfig`, `tagAndCommit`, `fileIssue`, `log`.
- `scenariosConfig` (`ScenariosPaths`) resolves from `loadProjectConfig(basePath).scenarios`, defaulting to `features/per-issue/` (per-issue dir), `features/regression/` (destination dir), and `features/regression/vocabulary.md` (vocabulary registry) when a target repo hasn't declared these in `.adw/scenarios.md`.
- `defaultListPromotionIssues` queries `gh issue list` scoped to `label:"regression-promotion"`, `state: 'all'`, fields `number,body,state,labels`, `limit: 200` — the all-state query is what lets the reconcile classifier distinguish a closed/blocked tracker from a genuinely missing one.
- `ListOpenIssuesOptions.state?: 'open' | 'closed' | 'all'` (`adws/gitContext/commands/issueCommands.ts`) defaults to `'open'`, preserving every other caller's behaviour unchanged.
- CLI entry point: `bunx tsx adws/triggers/promotionSweep.ts` (guarded by `process.argv[1]` containing `promotionSweep`, not `import.meta.main` — verified `tsx` runs under Node, where that Bun-only global is `undefined`).
- `PROMOTION_SWEEP_INTERVAL_CYCLES` (`adws/core/config.ts`, barrel-exported from `adws/core/index.ts`) — cron cadence gate consumed by `runPromotionSweepTick`. Defaults to `4320` (≈ once per day at the 20s `POLL_INTERVAL_MS` poll), overridable via the env var of the same name; a non-numeric override falls through `parseInt` to `NaN` like its siblings (no bespoke validation).

## Gotchas

- `runPromotionSweep` is now live in the cron loop (via `runPromotionSweepTick`, gated at `PROMOTION_SWEEP_INTERVAL_CYCLES` ≈ once/day) — it runs against the live repo (real commits/issue filings) once eligible. It is still never invoked from `bun run test:unit` or any CI validation step; the sweep's own unit/BDD coverage exercises the pure deciders and the dispatch seam (`runPromotionSweepTick`) with an injected `sweep`, not the real `runPromotionSweep` against real git/gh.
- On cron start `cycleCount` begins at 0 and increments to 1 on the first tick, so the first cron-driven sweep fires at `cycleCount === PROMOTION_SWEEP_INTERVAL_CYCLES` (≈24h later), identical to the sibling per-issue sweep. For immediate go-live backlog processing (re-scoring `@promotion-suggested-*` files already on disk), the operator runs the manual CLI once rather than waiting for the first cadence-eligible cycle.
- `ADW_REGRESSION_PROMOTION_LABEL = 'regression-promotion'` (`adws/github/labelManager.ts`) is deliberately kept out of `ADW_CLASSIFICATION_LABELS` (must stay invisible to `LABEL_TO_COMMAND` routing) and out of `ADW_LABEL_DEFINITIONS` (keeps `ensureAdwLabelsExist`'s six-label `N/6` loop unchanged); it resolves for lazy-create only via `resolveLabelDefinition`'s widened lookup array.
- `GitContext.addAndCommitPaths` / `commitOps.addAndCommitPaths` is a scoped modify-and-commit primitive (the counterpart to the existing `removeAndCommitPaths`) — required to honour "never `git add -A`". It is purely additive to `commitOps.ts`/`gitContext.ts` and does not touch the upgrade-regen `excludePaths` code path.
- A promotion issue carries zero `@adw-{promotionIssueN}` BDD scenarios of its own — the pipeline stays green only because `@adw-{issueNumber}` remains `optional: true` in the review-proof defaults.
- `reconcilePromotionLink`'s tie-break (lowest issue number wins when multiple trackers promote the same `feature-N`, e.g. a redrive filing a second one) is deterministic and state-agnostic — it picks the canonical tracker regardless of whether it's open, closed, or blocked.
- `merged`/`done` remain in the `PromotionAction`/`ReconcileFact` type surface and the decider's exhaustive unit tests for a stable contract, but stay deliberately **shell-unreachable**: "done" is realized by a merged file's absence from `listPerIssueFeatures()`, not by a reconcile fact. Decline is deliberately **not** gated on the tracking issue's `stateReason` (e.g. `COMPLETED`) — that would let a "closed as completed but not merged" issue masquerade as done and strand its still-present source file, which is strictly worse than declining it.
- Distinguishing `decline` from `redrive`/`withdraw` hinges entirely on the all-state issue listing: a **closed** tracker → `closed-unmerged` (durable rejection, decline); a **missing** tracker → `no-issue` (crash-stranded, redrive-if-qualifying or withdraw-if-not). Without the all-state query both look identical.
- The reconciliation listing caps at `limit: 200`; if promotion issues ever exceed that, a real tracker could be missed → false `no-issue` → a spurious redrive (duplicate issue). Pagination is out of scope.
