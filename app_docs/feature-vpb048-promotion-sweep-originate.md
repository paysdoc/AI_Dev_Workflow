# Promotion Sweep — Originate Path

## Overview

This module is the **originate half** of the automated scenario promotion sweep: a hand-invokable CLI (`bunx tsx adws/triggers/promotionSweep.ts`) that scores tracked `features/per-issue/feature-N.feature` files with the existing deterministic scorer/threshold, and for a fresh high scorer, durably marks it `@promotion-suggested-<date>` on the default branch and files a precise, `hitl`-gated `adw:feature` + `regression-promotion` promotion issue. It never performs the relocation itself — that is done by the normal SDLC pipeline once the promotion issue is picked up (the pattern proven by hand in issue #734). It is deliberately **not** wired into `trigger_cron.ts` yet; that interval-gated wiring, plus the `decline | redrive | withdraw` reconciliation actions, are a later slice.

## Responsibilities

- `decidePromotionAction(input)` (`adws/core/promotionSweepDecider.ts`) — pure lifecycle decider mapping `{ tagState, meetsThreshold, reconcile }` to a single `PromotionAction`. This slice emits only the `originate | leave | done` subset; `decline | redrive | withdraw` and the `closed-unmerged | blocked` reconciliation facts are declared for a stable type surface but always resolve to `leave`.
- `parsePromotesMarker` / `reconcilePromotionLink` / `reconcileFactFor` (`adws/core/promotionReconcileLink.ts`) — pure matcher that parses the `Promotes: feature-N` back-link line from a promotion issue's body and links a `feature-N` id to its open tracking issue, so a candidate already in flight is never re-originated. Multiple open issues promoting the same feature resolve to the lowest issue number (earliest-filed is canonical).
- `buildPromotionIssue(input)` (`adws/core/promotionIssueBody.ts`) — pure builder that produces the `{ title, body, labels }` for the promotion issue: a `Promotes: feature-N` marker line, a #734-shaped relocation instruction (`git mv` of the feature + step-def files, add `@regression`, register phrases in the vocabulary registry, prove `@regression` green), and the fixed label set `['adw:feature', 'regression-promotion', 'hitl']`.
- `runPromotionSweep(deps)` (`adws/triggers/promotionSweep.ts`) — the non-fatal, dependency-injected imperative shell. Mirrors `runPerIssueScenarioSweep`: lists tracked per-issue files, scores each via the reused scorer/threshold, reconciles against open `regression-promotion` issues, calls the decider, and on `originate` writes the tag (scoped commit) and files the issue.
- `adws/triggers/promotionSweepDefaults.ts` — the production dependency implementations (`GitContext` + `loadProjectConfig` + `fs`-backed) that `PromotionSweepDeps` falls back to when no override is injected; split out to keep `promotionSweep.ts` under the file-length guideline.

## Contracts & Invariants

- `decidePromotionAction` is pure and total over its input cross-product: `reconcile === 'merged'` always wins → `'done'`; `tagState: 'none' && meetsThreshold && reconcile: 'no-issue'` → `'originate'`; every other cell → `'leave'`.
- The origination write path is idempotent: `serializePromotionTagState(content, 'suggested', { date })` is byte-idempotent for the same date, and `GitContext.addAndCommitPaths` no-ops (returns `false`, no commit) when nothing is staged for the given path — so a file the decider already routes away from `originate` (only reachable when `tagState: 'none'`) can never be double-committed.
- `runPromotionSweep` never throws in normal operation: each candidate's decode/score/originate step is wrapped so a parse failure, unreadable file, or transient git/gh error during origination is logged (`warn`) and swallowed — the loop continues to the next file and the sweep still returns a `PromotionSweepReport`.
- The origination commit is **scoped** to exactly the candidate's feature-file path (`GitContext.addAndCommitPaths`, never `commitChanges`'s `git add -A`), so unrelated dirty state on the host is never swept in.
- `tagAndCommit` only mutates when the checkout is on the default branch (`ctx.getCurrentBranch() === ctx.defaultBranch()`); off-branch is a logged no-op, not an error.
- A merged promotion (file already `git mv`-ed out of `features/per-issue/`) is structurally `done` — it is simply absent from `listPerIssueFeatures()` and never reprocessed. The decider's `reconcile === 'merged'` branch is a forward-compat/defensive hook, unit-tested but not emitted by this slice's shell (which only ever produces `open | no-issue` reconcile facts).
- `promotionIssueBody` and the `runPromotionSweep` shell are integration/BDD-covered (`@adw-740`), not unit-tested against git/gh mocks; `promotionSweepDecider` and `promotionReconcileLink` are pure and exhaustively unit-tested instead.

## Configuration

- `PromotionSweepDeps` (all optional, production defaults from `promotionSweepDefaults.ts`): `now`, `listPerIssueFeatures`, `readFeatureContent`, `listStepDefSiblings`, `loadVocabulary`, `loadStats`, `listOpenPromotionIssues`, `scenariosConfig`, `tagAndCommit`, `fileIssue`, `log`.
- `scenariosConfig` (`ScenariosPaths`) resolves from `loadProjectConfig(basePath).scenarios`, defaulting to `features/per-issue/` (per-issue dir), `features/regression/` (destination dir), and `features/regression/vocabulary.md` (vocabulary registry) when a target repo hasn't declared these in `.adw/scenarios.md`.
- `listOpenPromotionIssues` queries `gh issue list` scoped to `label:"regression-promotion"` and state `open` (fields `number,body`) — the shell only ever sees `open | no-issue` reconcile facts; `merged`/`closed-unmerged`/`blocked` require issue-state queries that belong to the sibling reconcile-path slice.
- CLI entry point: `bunx tsx adws/triggers/promotionSweep.ts` (guarded by `process.argv[1]` containing `promotionSweep`, not `import.meta.main` — verified `tsx` runs under Node, where that Bun-only global is `undefined`).

## Gotchas

- This slice intentionally does not wire `runPromotionSweep` into `trigger_cron.ts` — running it against a live repo creates real commits/issues and must only be done by hand against a disposable test repo, never as part of `bun run test:unit`.
- `ADW_REGRESSION_PROMOTION_LABEL = 'regression-promotion'` (`adws/github/labelManager.ts`) is deliberately kept out of `ADW_CLASSIFICATION_LABELS` (must stay invisible to `LABEL_TO_COMMAND` routing) and out of `ADW_LABEL_DEFINITIONS` (keeps `ensureAdwLabelsExist`'s six-label `N/6` loop unchanged); it resolves for lazy-create only via `resolveLabelDefinition`'s widened lookup array.
- `GitContext.addAndCommitPaths` / `commitOps.addAndCommitPaths` is a new scoped modify-and-commit primitive (the counterpart to the existing `removeAndCommitPaths`) added specifically because no existing `GitContext` method commits a *modified* file scoped to its path — required to honour "never `git add -A`". It is purely additive to `commitOps.ts`/`gitContext.ts` and does not touch the upgrade-regen `excludePaths` code path.
- A promotion issue carries zero `@adw-{promotionIssueN}` BDD scenarios of its own — the pipeline stays green only because `@adw-{issueNumber}` remains `optional: true` in the review-proof defaults; this slice does not add scenario authoring for the promotion issue.
- `reconcilePromotionLink`'s tie-break (lowest issue number wins when two open issues both promote the same `feature-N`) is a documented, deterministic edge-case handler, not expected in normal operation (the `originate` guard prevents a second issue from ever being filed for a candidate that already has one linked).
