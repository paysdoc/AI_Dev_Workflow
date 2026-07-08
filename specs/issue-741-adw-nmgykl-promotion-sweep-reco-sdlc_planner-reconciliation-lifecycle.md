# Feature: Promotion sweep — reconciliation lifecycle (decline / redrive / withdraw)

## Metadata
issueNumber: `741`
adwId: `nmgykl-promotion-sweep-reco`
issueJson: `{"number":741,"title":"Promotion sweep — reconciliation lifecycle (decline/redrive/withdraw)","body":"## Parent PRD\n\n`specs/prd/automated-scenario-promotion-sweep.md` (PR #738)\n\n## What to build\n\nExtend `promotionSweepDecider` and the `runPromotionSweep` shell to handle the full in-flight lifecycle beyond originate/leave/done. For each `@promotion-suggested-*` file reconciled against its tracking issue/PR:\n\n- `closed-unmerged` OR the tracking issue carries `adw:blocked` → **decline**: write terminal `@promotion-declined` to the source file (resumes TTL); leave a blocked tracking issue as the normal human-escalation artifact\n- tracking issue/PR **missing** (stranded by a crash between tagging and PR-open) → **redrive**: re-file, but re-score first and **withdraw** (strip the tag, resume TTL) if it no longer meets threshold (score-drop)\n\nThis closes the infinite-re-suggestion loop and the blocked-promotion stranding hole. See PRD user stories 18-20 and Implementation Decision \"promotionSweepDecider\".\n\n## Acceptance criteria\n\n- [ ] A candidate whose promotion PR/issue was closed unmerged gets `@promotion-declined` written and is thereafter never re-suggested\n- [ ] A candidate whose tracking issue reached `adw:blocked` gets `@promotion-declined` on the source file; the blocked issue is left intact\n- [ ] A candidate tagged in-flight but with no tracking issue/PR (stranded) is re-filed if it still scores >= threshold\n- [ ] A stranded candidate that now scores below threshold is withdrawn (tag stripped, TTL resumes) instead of re-filed\n- [ ] Decider remains pure; the new lifecycle branches are unit-tested exhaustively (decline-closed, decline-blocked, redrive, withdraw)\n\n## Blocked by\n\n- Blocked by #740\n\n## Touched Files\n\n- adws/core/promotionSweepDecider.ts\n- adws/triggers/promotionSweep.ts\n\n## User stories addressed\n\n- User story 16\n- User story 17\n- User story 18\n- User story 19\n- User story 20"}`

## Feature Description

The automated scenario-promotion sweep (parent PRD `specs/prd/automated-scenario-promotion-sweep.md`) periodically scores per-issue BDD scenarios, marks high scorers `@promotion-suggested-<date>` on the default branch, and files a `#734`-shaped `adw:feature` + `regression-promotion` + `hitl` promotion issue that the normal SDLC pipeline turns into a human-gated PR. The sibling slice **#740** built only the **originate half** — the `originate | leave | done` subset of the decider — and left the reconcile actions (`decline | redrive | withdraw`) and their driving reconciliation facts (`closed-unmerged | blocked`) declared-but-unhandled: every not-yet-handled fact resolves to the conservative `leave` no-op.

This feature completes the in-flight lifecycle. For each `@promotion-suggested-*` file, the sweep reconciles it against its tracking issue and takes the terminal action the design requires:

- **decline** — the tracking issue/PR was **closed unmerged** (the maintainer rejected the promotion), *or* the tracking issue carries **`adw:blocked`** (the promotion workflow exhausted its retries and escalated to human). The sweep writes a terminal `@promotion-declined` marker to the source file so it is never re-suggested; TTL resumes (a declined file is not promotion-exempt) and the file eventually ages out normally. A blocked tracking issue is **left intact** as the human-escalation artifact.
- **redrive** — the file is tagged in-flight but **no tracking issue exists** (a crash stranded it between tagging and issue/PR-open). The sweep re-files the `#734`-shaped issue — but only after re-scoring.
- **withdraw** — a stranded (no-issue) candidate that **no longer meets threshold** (its score drifted below the auto-ramped bar). Instead of re-filing, the sweep strips the `@promotion-suggested-*` tag (state → `none`), resuming TTL, so a stale candidate is cleanly withdrawn rather than promoted.

The value: this closes two holes the PRD calls out — the **infinite re-suggestion loop** (a rejected candidate re-suggested every cycle) and the **blocked/stranded-promotion stranding hole** (a tagged, TTL-exempt, un-promotable file sitting forever). The decider stays a pure, exhaustively unit-tested decision function; the shell's new branches are thin, non-fatal executors that reuse #740's existing tag-write and issue-file seams.

## User Story

As an ADW maintainer,
I want the promotion sweep to reconcile each in-flight `@promotion-suggested-*` file against its tracking issue and decline (on rejection or `adw:blocked`), redrive (on a crash-stranded candidate that still qualifies), or withdraw (on a stranded candidate whose score dropped),
So that a rejected promotion is durably suppressed, a blocked promotion escalates cleanly without stranding its source file, and a crash between tagging and PR-open cannot permanently strand a tagged, TTL-exempt, unpromoted file.

## Problem Statement

#740's decider emits only `originate | leave | done`. Its reconciliation query (`reconcileFactFor`) returns only `open | no-issue` from the **open** issues list, so the sweep cannot see a **closed** tracking issue at all. Consequences:

1. **Rejection is not durable.** When a maintainer closes a promotion PR/issue without merging, the source file keeps its `@promotion-suggested-*` tag. On #740's rules a tagged file with no *open* issue would (once reconcile could see it) look identical to a crash-stranded file — there is no way to distinguish "human said no" from "crashed before filing", so the sweep would either re-suggest a rejected candidate forever (re-suggestion loop) or wrongly decline a genuinely-stranded valid one.
2. **`adw:blocked` promotions strand their source file.** When a promotion workflow exhausts retries and escalates to `adw:blocked`, the tracking issue stays open (the human-escalation artifact) and the source file stays `@promotion-suggested-*` — TTL-exempt and unpromotable, sitting forever.
3. **A crash between tagging and issue-filing strands a valid candidate.** #740 writes the tag first, then files the issue; if the filing throws, the file is tagged in-flight with no tracker. Nothing re-drives it.

To resolve these the sweep must (a) distinguish a **closed** tracker from a **missing** tracker (requires querying closed issues + their state/labels), and (b) route the four new lifecycle actions through the pure decider and execute them non-fatally.

## Solution Statement

Extend the two pure deciders and the imperative shell #740 built, plus the one gitContext command builder they depend on for the richer reconciliation query:

1. **`promotionSweepDecider` (`decidePromotionAction`)** — extend the decision table so `suggested` + `closed-unmerged`/`blocked` → `decline`, `suggested` + `no-issue` + `meetsThreshold` → `redrive`, and `suggested` + `no-issue` + `!meetsThreshold` → `withdraw`. `merged` → `done` and the `none`/`declined` rows are unchanged. The function stays pure (guard-clause style, max depth 2).
2. **`promotionReconcileLink` (`reconcileFactFor`, `PromotionIssueRef`)** — widen `PromotionIssueRef` with optional `state` and `labels`, and widen `reconcileFactFor` to return the full `ReconcileFact` union. It reuses the existing, tested `reconcilePromotionLink` (lowest-issue-number tie-break) to find the canonical tracker, then classifies it: `adw:blocked` label → `blocked`; open → `open`; closed → `closed-unmerged`; no tracker → `no-issue`. (See **Note on `merged`/`done`** below for why the shell never emits `merged`.)
3. **`runPromotionSweep` shell (`promotionSweep.ts`)** — add non-fatal executors for `decline` (write `@promotion-declined` via the existing `tagAndCommit` seam), `withdraw` (strip the tag → state `none` via `tagAndCommit`), and `redrive` (re-file via the existing `fileIssue` seam), and route them from `processCandidate`'s action switch. Extend `PromotionSweepReport` with `declined`/`redriven`/`withdrawn`.
4. **`promotionSweepDefaults.ts`** — widen the reconciliation listing to query promotion issues in **all** states with `state` + `labels` fields, so the reconcile classifier can see closed and blocked trackers. Decline/withdraw reuse the existing `defaultTagAndCommit`; redrive reuses the existing `defaultFileIssue` — no new default executors.
5. **`gitContext/commands/issueCommands.ts`** — add an optional `state` field to `ListOpenIssuesOptions` (default `'open'`) threaded into `listOpenIssuesCmd`, so the sweep can list closed promotion issues. Backward-compatible: every existing caller keeps `--state open`.

The pure deciders are unit-tested exhaustively (AC5); the `runPromotionSweep` shell's observable behaviour (marker written, issue filed / not filed, blocked issue left intact) is BDD-covered, mirroring #740's split.

### Note on `merged`/`done` (deliberate, matches #740)

The decider retains `merged → done`, but the **shell never emits `merged`**, exactly as #740 left `done` shell-unreachable. Rationale: a merged promotion's build step `git mv`s the source file out of `features/per-issue/`, so a promoted candidate is no longer listed by `defaultListPerIssueFeatures` — "done" is realised by **absence** (PRD US15: "its file has left `features/per-issue/`"), not by a reconcile fact. Because the sweep only ever processes files that are still present, a still-present file whose tracker is closed cannot have been merged; it is classified `closed-unmerged` → `decline`. Gating on the issue's close reason (`stateReason: COMPLETED`) is explicitly **rejected** here: it would let a "closed as completed but not actually merged" issue map to `done`, stranding its still-present source file forever — strictly worse than declining it. `merged`/`done` remain in the type surface (and in the decider's exhaustive tests) for a stable contract, unreachable from the shell.

## Relevant Files

Use these files to implement the feature:

- `adws/core/promotionSweepDecider.ts` — **primary.** The pure lifecycle decider. Extend `decidePromotionAction` to emit `decline | redrive | withdraw` (already declared in `PromotionAction`). Rewrite the file's leading decision-table docblock to describe the full lifecycle (it currently says "This slice (issue #740, the originate half) emits only the `originate | leave | done` subset").
- `adws/core/promotionReconcileLink.ts` — **primary.** Widen `PromotionIssueRef` (add optional `state`, `labels`) and widen `reconcileFactFor` to return the full `ReconcileFact` (imported from `promotionSweepDecider`). Reuse `reconcilePromotionLink` for linkage + tie-break; add pure `blocked`/`open`/`closed` classification. Import `ADW_BLOCKED_LABEL` from `../github/labelManager` (precedent: `promotionIssueBody.ts` already imports label constants from there). Update the header docblock (currently "maps a `feature-N` id to its linked **open** issue").
- `adws/triggers/promotionSweep.ts` — **primary (issue Touched File).** The `runPromotionSweep` shell. Add the three non-fatal action executors and route them; extend `PromotionSweepReport` and the `CandidateOutcome` union; rename the all-state listing dep (`listOpenPromotionIssues` → `listPromotionIssues`) and the context field (`openIssues` → `promotionIssues`) for honesty. Update the header docblock (drops "originate path" framing).
- `adws/triggers/promotionSweepDefaults.ts` — **primary.** Widen `defaultListOpenPromotionIssues` → `defaultListPromotionIssues`: query `state: 'all'`, fields `['number','body','state','labels']`, higher limit. Reuse existing `defaultTagAndCommit` / `defaultFileIssue`.
- `adws/gitContext/commands/issueCommands.ts` — **supporting.** Add optional `state?: 'open' | 'closed' | 'all'` to `ListOpenIssuesOptions`; thread `--state ${opts.state ?? 'open'}` into `listOpenIssuesCmd`. Backward-compatible (default `'open'`).
- `adws/core/promotionTagState.ts` — **read-only reference.** The tag state machine (`none → suggested → declined`). `serializePromotionTagState(content, 'declined')` performs the decline write; `serializePromotionTagState(content, 'none')` performs the withdraw (tag-strip). No changes needed — the serializer already supports every target this feature uses (only `'suggested'` requires `opts.date`). `isPromotionExempt` already returns `false` for `declined` and `none`, so TTL resume is automatic.
- `adws/core/promotionIssueBody.ts` — **read-only reference.** `buildPromotionIssue` is reused verbatim by the redrive executor (same `#734`-shaped body the originate path files).
- `adws/triggers/perIssueScenarioSweep.ts` — **read-only reference.** The sibling non-fatal, dependency-injected sweep this shell mirrors; its `defaultPersistRemoval` is the model for "log-and-swallow, self-heal next sweep". It already composes `isPromotionExempt(parsePromotionTagState(...))`, so a declined/withdrawn file becomes sweep-eligible automatically.
- `adws/github/labelManager.ts` — **read-only reference.** `ADW_BLOCKED_LABEL = 'adw:blocked'` (the escalation label reconcile keys on) and `ADW_REGRESSION_PROMOTION_LABEL = 'regression-promotion'` (the reconcile query filter).
- `adws/gitContext/gitContext.ts` — **read-only reference.** `listOpenIssues(opts)` (line 375) delegates to `listOpenIssuesCmd`; the new `state` option flows through unchanged here.

### New Files

- `adws/core/__tests__/promotionReconcileLink.test.ts` — **exists**; extend, do not create. Add classification cases (open→`open`, closed→`closed-unmerged`, `adw:blocked`-labelled→`blocked`, no-tracker→`no-issue`, mixed-state lowest-number tie-break).
- `adws/gitContext/commands/__tests__/issueCommands.test.ts` — **new** (no command-builder test exists today). Small focused test asserting `listOpenIssuesCmd` emits `--state open` by default and `--state all`/`--state closed` when the option is set.
- `features/per-issue/feature-741.feature` + `features/per-issue/step_definitions/feature-741.steps.ts` — **new**, authored by the scenario/step-def phases (not hand-written in this plan). Pin the observable shell behaviour of the reconcile lifecycle (see Testing Strategy). Mirror `features/per-issue/feature-740.feature`'s conventions: bespoke self-contained `@adw-741` step defs over a real temp git repo with an injected reconciliation list and a capturing issue filer.

### Conditional docs consulted

Per `.adw/conditional_docs.md`, the relevant entry is `app_docs/feature-vpb048-promotion-sweep-originate.md` (owns `promotionSweep.ts`, `promotionSweepDefaults.ts`, `promotionSweepDecider.ts`, `promotionReconcileLink.ts`, `promotionIssueBody.ts`) and `app_docs/feature-ne2we8-promotion-tag-state.md` (owns `promotionTagState.ts`). These are the #739/#740 companion docs for the modules this feature extends. No condition requires additional runtime docs beyond them.

## Implementation Plan

### Phase 1: Foundation — richer reconciliation inputs

Before the decider can act on the new facts, the reconcile layer must be able to *produce* them, which requires seeing closed/blocked trackers. Widen the gitContext command builder (`state` option), then widen `PromotionIssueRef` and `reconcileFactFor` to classify a tracker's state/labels into the full `ReconcileFact`.

### Phase 2: Core Implementation — the decider lifecycle branches

Extend the pure `decidePromotionAction` to map the new fact/tag combinations to `decline | redrive | withdraw`, keeping it pure and exhaustively covered. This is the highest-value, lowest-risk change and the heart of the acceptance criteria.

### Phase 3: Integration — shell executors + widened production query

Wire the new actions into the `runPromotionSweep` shell as non-fatal executors reusing #740's tag-write and issue-file seams, widen the production reconciliation listing to all-state, and extend the report. Then prove the whole path green (unit + BDD + type-check + regression).

## Step by Step Tasks

Execute every step in order, top to bottom.

### Task 1: Widen the gitContext issue-list command with a `state` option

- In `adws/gitContext/commands/issueCommands.ts`, add an optional field to `ListOpenIssuesOptions`:
  - `readonly state?: 'open' | 'closed' | 'all';`
- In `listOpenIssuesCmd`, replace the hardcoded `--state open` with `--state ${opts.state ?? 'open'}` so the default is unchanged for every existing caller.
- Keep the existing `--search` / `--limit` / `--json` handling exactly as-is.

### Task 2: Unit-test the command-builder change

- Create `adws/gitContext/commands/__tests__/issueCommands.test.ts`.
- Assert: `listOpenIssuesCmd('o','r',{fields:['number']})` contains `--state open` (default preserved); with `{state:'all'}` contains `--state all`; with `{state:'closed'}` contains `--state closed`; and that `--search`/`--limit` still render when supplied. Match the existing command-builder testing style (plain string `.toContain` assertions).

### Task 3: Widen `PromotionIssueRef` and `reconcileFactFor`

- In `adws/core/promotionReconcileLink.ts`:
  - Import the fact type: `import type { ReconcileFact } from './promotionSweepDecider';` (one-directional — the decider does **not** import reconcile, so no cycle).
  - Import the label constant: `import { ADW_BLOCKED_LABEL } from '../github/labelManager';`.
  - Widen the interface (keep new fields optional so existing `{number, body}` test fixtures and the linkage function stay valid):
    ```ts
    export interface PromotionIssueRef {
      number: number;
      body: string;
      state?: string;                        // 'OPEN' | 'CLOSED' from `gh --json state` (uppercase; compared case-insensitively)
      labels?: readonly { name: string }[];  // from `gh --json labels`
    }
    ```
  - Add small pure helpers (guard-clause style): `issueIsOpen(ref)` = `ref.state === undefined || ref.state.toUpperCase() === 'OPEN'`; `issueIsBlocked(ref)` = `(ref.labels ?? []).some(l => l.name === ADW_BLOCKED_LABEL)`.
  - Replace `reconcileFactFor`'s narrow `'open' | 'no-issue'` return with the full `ReconcileFact`:
    ```ts
    export function reconcileFactFor(feature: string, issues: readonly PromotionIssueRef[]): ReconcileFact {
      const num = reconcilePromotionLink(feature, issues);
      if (num === null) return 'no-issue';
      const tracker = issues.find(i => i.number === num);
      if (!tracker) return 'no-issue';                 // defensive; reconcilePromotionLink only returns a present number
      if (issueIsBlocked(tracker)) return 'blocked';
      return issueIsOpen(tracker) ? 'open' : 'closed-unmerged';
    }
    ```
  - Update the header docblock to describe the full classification (open / closed-unmerged / blocked / no-issue) and reference the all-state injected listing. Note explicitly that `merged` is not produced here (handled by file-absence — see decider docblock).
- Rationale to preserve: `reconcilePromotionLink` still filters by `Promotes: feature-N` body match and keeps the documented lowest-issue-number tie-break; passing it the widened all-state list makes it find the canonical tracker regardless of state.

### Task 4: Extend the reconcile-link unit tests

- In `adws/core/__tests__/promotionReconcileLink.test.ts`, extend the `reconcileFactFor` describe block (keep the existing `open`/`no-issue` cases green — they must still pass with `state`/`labels` omitted):
  - open tracker (`state:'OPEN'`, no blocked label) → `'open'`.
  - closed tracker (`state:'CLOSED'`) → `'closed-unmerged'`.
  - open tracker carrying `labels:[{name:'adw:blocked'}]` → `'blocked'`.
  - closed tracker carrying `adw:blocked` → `'blocked'` (blocked label wins over closed-state classification; both decline anyway).
  - no linked tracker → `'no-issue'`.
  - lowest-number tie-break across mixed states: an open `#205` and a closed `#101` both `Promotes: feature-42` → canonical is `#101` (lowest) → `'closed-unmerged'`.
  - case-insensitivity: `state:'closed'` (lowercase) also → `'closed-unmerged'`.

### Task 5: Extend the pure decider (`decidePromotionAction`)

- In `adws/core/promotionSweepDecider.ts`, replace the body of `decidePromotionAction` with the full lifecycle mapping, keeping it pure and guard-clause structured (max depth 2):
  ```ts
  export function decidePromotionAction(input: PromotionDecisionInput): PromotionAction {
    const { tagState, meetsThreshold, reconcile } = input;

    if (reconcile === 'merged') return 'done';           // already promoted — wins over everything

    if (tagState === 'none') {
      return meetsThreshold && reconcile === 'no-issue' ? 'originate' : 'leave';
    }

    if (tagState === 'suggested') {
      if (reconcile === 'closed-unmerged' || reconcile === 'blocked') return 'decline';
      if (reconcile === 'no-issue') return meetsThreshold ? 'redrive' : 'withdraw';
      return 'leave';                                    // open → in flight
    }

    return 'leave';                                      // declined → terminal
  }
  ```
- Rewrite the leading decision-table docblock to reflect the full lifecycle (replace the "#740, the originate half … emits only originate | leave | done" framing). Include the complete table:

  | tagState  | meetsThreshold | reconcile         | action    |
  |-----------|----------------|-------------------|-----------|
  | any       | any            | merged            | done      |
  | none      | true           | no-issue          | originate |
  | none      | false          | no-issue          | leave     |
  | none      | any            | open/closed/blocked | leave   |
  | suggested | any            | open              | leave     |
  | suggested | any            | closed-unmerged   | decline   |
  | suggested | any            | blocked           | decline   |
  | suggested | true           | no-issue          | redrive   |
  | suggested | false          | no-issue          | withdraw  |
  | declined  | any            | (non-merged)      | leave     |

- Document in the docblock that `merged`/`done` are decider-level only (the shell derives "done" from file-absence; see reconcile docblock) so a future reader does not mistake `done`'s shell-unreachability for a bug.

### Task 6: Rewrite the decider unit tests to the real lifecycle

- In `adws/core/__tests__/promotionSweepDecider.test.ts`, the exhaustive cross-product must now assert the real actions (the current file asserts the #740 placeholders — those expectations flip):
  - `tagState: 'suggested'` rows change: `closed-unmerged` → `decline` (both threshold values); `blocked` → `decline` (both threshold values); `no-issue` + `meetsThreshold:true` → `redrive`; `no-issue` + `meetsThreshold:false` → `withdraw`. `open` stays `leave`; `merged` stays `done`.
  - `tagState: 'none'` rows are **unchanged** (originate on `true`+`no-issue`; every other combination `leave`; `merged` `done`).
  - `tagState: 'declined'` rows are **unchanged** (all `leave` except `merged` `done`).
  - Replace the named test `'deferred reconciliation facts (closed-unmerged, blocked) → leave — placeholder for the sibling reconcile slice'` with real named lifecycle-edge tests: `decline-closed`, `decline-blocked`, `redrive` (stranded high scorer), `withdraw` (stranded score-drop), plus `untagged file ignores closed/blocked facts → leave` (the `none` rows). Keep the `merged → done regardless of tag/threshold` and `declined (terminal) → leave` named tests.
- Confirm the full `{tagState} × {meetsThreshold} × {reconcile}` grid remains exhaustive (3 × 2 × 5 = 30 assertions) so AC5 ("unit-tested exhaustively") holds.

### Task 7: Widen the production reconciliation listing

- In `adws/triggers/promotionSweepDefaults.ts`, rename `defaultListOpenPromotionIssues` → `defaultListPromotionIssues` and widen the query:
  ```ts
  export function defaultListPromotionIssues(): PromotionIssueRef[] {
    try {
      const ctx = gitContextForRepo(getRepoInfo());
      const json = ctx.listOpenIssues({
        fields: ['number', 'body', 'state', 'labels'],
        state: 'all',
        search: `label:"${ADW_REGRESSION_PROMOTION_LABEL}"`,
        limit: 200,
      });
      return JSON.parse(json) as PromotionIssueRef[];
    } catch {
      return [];
    }
  }
  ```
  - Import `ADW_REGRESSION_PROMOTION_LABEL` from `../github/labelManager` for the search filter (replaces the inline `'regression-promotion'` string).
  - Keep the fail-safe `catch → []` (self-defending default, matching every other default in this file).
- Do **not** add new default executors: `defaultTagAndCommit` already writes arbitrary content + scoped commit (decline and withdraw both just serialize different tag content), and `defaultFileIssue` already files an issue (redrive).

### Task 8: Add the shell's non-fatal action executors

- In `adws/triggers/promotionSweep.ts`:
  - Update the `PromotionSweepDeps` field rename: `listOpenPromotionIssues?` → `listPromotionIssues?`, defaulting to `defaultListPromotionIssues`. Update the `import { ... }` from `./promotionSweepDefaults` accordingly.
  - Rename `SweepContext.openIssues` → `SweepContext.promotionIssues` and the `reconcileFactFor(..., ctx.promotionIssues)` call site.
  - Extend `PromotionSweepReport`:
    ```ts
    export interface PromotionSweepReport {
      originated: number[];
      redriven: number[];
      declined: string[];
      withdrawn: string[];
      left: string[];
    }
    ```
  - Extend the `CandidateOutcome` union with `{ kind: 'declined'; filePath: string }`, `{ kind: 'redriven'; featureNumber: number }`, `{ kind: 'withdrawn'; filePath: string }`, and a generic `{ kind: 'action-failed'; filePath: string }` (the non-fatal failure outcome; keep the existing `'origination-failed'` or fold it into `action-failed` — prefer folding for one failure kind).
  - Extract the issue-filing body of `attemptOriginate` into a shared helper so redrive reuses it:
    ```ts
    function fileIssueFor(filePath: string, featureNumber: number, scenarios: readonly Scenario[], ctx: SweepContext): void {
      const spec = buildPromotionIssue({
        featureNumber,
        sourceFeaturePath: filePath,
        sourceStepDefPaths: ctx.listStepDefSiblings(featureNumber),
        destinationRegressionDir: ctx.scenariosConfig.regressionDir,
        vocabularyRegistryPath: ctx.scenariosConfig.vocabPath,
        phrases: dedupedPhrases(scenarios),
        score: bestScore(scenarios, ctx.registry),
      });
      ctx.fileIssue(spec);
    }
    ```
    Refactor `attemptOriginate` to call `fileIssueFor` after its `tagAndCommit`.
  - Add a non-fatal tag-write helper reused by decline and withdraw:
    ```ts
    function attemptTagWrite(filePath: string, content: string, target: PromotionTagState, message: string, ctx: SweepContext): boolean {
      try {
        ctx.tagAndCommit(filePath, serializePromotionTagState(content, target), message);
        return true;
      } catch (err) {
        ctx.logger(`promotionSweep: ${target} write failed for ${filePath}: ${err} — leaving for next sweep`, 'warn');
        return false;
      }
    }
    ```
    (`serializePromotionTagState` requires `opts.date` only for `'suggested'`; `'declined'` and `'none'` need none.)
  - Add a non-fatal redrive helper:
    ```ts
    function attemptRedrive(filePath: string, featureNumber: number, scenarios: readonly Scenario[], ctx: SweepContext): boolean {
      try {
        fileIssueFor(filePath, featureNumber, scenarios, ctx);
        ctx.logger(`promotionSweep: redrove stranded promotion for feature-${featureNumber}`, 'info');
        return true;
      } catch (err) {
        ctx.logger(`promotionSweep: redrive failed for ${filePath}: ${err} — leaving for next sweep`, 'warn');
        return false;
      }
    }
    ```
- Import `PromotionTagState` from `../core/promotionTagState` for the helper signature.

### Task 9: Route the new actions in `processCandidate`

- Replace the `if (action !== 'originate') { … return { kind: 'left' } }` early-return with an explicit action switch (guard-clause / early-return style, one branch per action). Decline and withdraw commit messages:
  - `decline` → `attemptTagWrite(filePath, content, 'declined', \`chore: mark feature-${featureNumber} promotion-declined\`, ctx)` → `declined`/`action-failed`.
  - `withdraw` → `attemptTagWrite(filePath, content, 'none', \`chore: withdraw feature-${featureNumber} promotion suggestion\`, ctx)` → `withdrawn`/`action-failed`.
  - `redrive` → `attemptRedrive(...)` → `redriven`/`action-failed`.
  - `originate` → `attemptOriginate(...)` → `originated`/`action-failed` (existing).
  - `leave` / `done` → log `promotionSweep: ${filePath} → ${action}` and return `{ kind: 'left', filePath }` (the `done` fact is shell-unreachable but handled defensively as a no-op).
- In `runPromotionSweep`, extend the outcome-to-report reduction so `declined`/`withdrawn` push `filePath` and `redriven` pushes `featureNumber`, alongside the existing `left`/`originated`.
- Keep the per-candidate `processCandidate` boundary as the single try/catch surface (each executor is already try/catch-wrapped and returns a boolean; a thrown scorer/parse error still routes to the existing `skip` guards). The shell must remain non-fatal end-to-end (a candidate error never aborts the loop).

### Task 10: Update the CLI summary log and module docblock

- Update the CLI `.then(...)` summary line to report the new counts, e.g. `originated ${r.originated.length}, redrove ${r.redriven.length}, declined ${r.declined.length}, withdrew ${r.withdrawn.length}, left ${r.left.length}`.
- Rewrite the `promotionSweep.ts` header docblock to describe the full reconcile lifecycle (it currently says "originate path (manual CLI, not yet wired into cron)"; keep the "not yet wired into cron" and "non-fatal / scoped-commit / never `git add -A`" notes, drop the "originate path" narrowing).

### Task 11: File-length guard (coding guideline: keep files < 300 lines)

- After Tasks 8-10, check `wc -l adws/triggers/promotionSweep.ts`. #740 left it at 221 lines; the additions are ~50-60 lines (~275-285). If it crosses 300, extract the per-candidate action executors (`attemptOriginate`, `attemptRedrive`, `attemptTagWrite`, `fileIssueFor`, and the pure `bestScore`/`dedupedPhrases`/`isoDate` helpers) into a new `adws/triggers/promotionSweepActions.ts`, mirroring how #740 split `promotionSweepDefaults.ts` "to keep `promotionSweep.ts`'s orchestration logic under the file-length guideline". Prefer keeping everything in one file if it stays under 300.

### Task 12: Author the BDD acceptance scenarios (scenario + step-def phases)

- The scenario phase authors `features/per-issue/feature-741.feature` tagged `@adw-741`, and the step-def phase authors `features/per-issue/step_definitions/feature-741.steps.ts` (self-contained, bespoke `@adw-741` step defs with their own `After` hook and module-private context — no reach into feature-739/740 step defs). Pin the observable reconcile lifecycle over a real temp git repo with an injected reconciliation list and a capturing issue filer (mirror `feature-740.feature`'s harness notes). Scenarios to cover the ACs:
  - **decline-closed:** a `@promotion-suggested-*` file whose injected reconciliation list carries a **closed** issue `Promotes: feature-N` → after the sweep the source file carries `@promotion-declined` (and no `@promotion-suggested-` token); no promotion issue is filed.
  - **decline-blocked:** a `@promotion-suggested-*` file whose tracker is **open** but carries `adw:blocked` → source file gets `@promotion-declined`; the blocked tracking issue is left intact (the capturing filer records zero new issues; no close call is made).
  - **redrive:** a `@promotion-suggested-*` file, still high-scoring, with **no** tracker in the reconciliation list → exactly one new `#734`-shaped promotion issue is filed (labels `adw:feature`/`regression-promotion`/`hitl`, body carries `Promotes: feature-N`); the file keeps exactly one `@promotion-suggested-` token.
  - **withdraw:** a `@promotion-suggested-*` file that now scores **below** threshold with no tracker → the sweep strips the tag (source file carries neither `@promotion-suggested-` nor `@promotion-declined`); no promotion issue is filed.
  - **non-fatal:** a transient failure in the injected decline write / redrive filing is logged and swallowed (the sweep completes without raising) — the AC5-adjacent resilience property.
  - **type-check backstop** (`@adw-741`): the ADW codebase still type-checks with the widened `PromotionIssueRef`/`reconcileFactFor` and the extended decider/shell.
- Follow the vocabulary/rot conventions in `feature-740.feature`: every Then targets an artefact the sweep **produces** (marker present/absent on the committed file, capturing-filer recorded args, whether the sweep raised) — never reads a source module as text. Introduce distinct, self-contained phrasing to avoid `AmbiguousStepDefinition` clashes under the globally-loaded step defs.

### Task 13: Run the full validation suite

- Execute every command in **Validation Commands** below and confirm zero errors and zero regressions.

## Testing Strategy

### Unit Tests

`.adw/project.md` sets `## Unit Tests: enabled`, so unit tests are in scope. The pure deciders are the primary unit targets (PRD Testing Decisions name them the highest-value tests; AC5 requires exhaustive decider coverage):

- **`promotionSweepDecider.test.ts`** — the exhaustive `{tagState} × {meetsThreshold} × {reconcile}` cross-product (30 cells), asserting the single correct action per cell, plus named lifecycle-edge tests: `originate`, `decline-closed`, `decline-blocked`, `redrive` (stranded high scorer), `withdraw` (stranded score-drop), `done` (merged, wins over tag/threshold), `leave` while `open`, terminal `declined → leave`, and untagged-ignores-closed/blocked. Assert only the returned action (never internal control flow), per the PRD's "externally-observable behaviour" testing rule.
- **`promotionReconcileLink.test.ts`** — extend `reconcileFactFor` coverage: open→`open`, closed→`closed-unmerged`, `adw:blocked`→`blocked` (open and closed), no-tracker→`no-issue`, mixed-state lowest-number tie-break, lowercase-`state` case-insensitivity. Keep the existing `parsePromotesMarker` / `reconcilePromotionLink` tests green (fixtures with only `{number, body}` must still compile and pass).
- **`issueCommands.test.ts`** (new) — `listOpenIssuesCmd` emits `--state open` by default, `--state all`/`--state closed` when the option is set, and still renders `--search`/`--limit`.

Not unit-tested (integration/BDD-covered, per the PRD and #740 precedent): the `runPromotionSweep` shell, `promotionSweepDefaults` production deps, `promotionIssueBody` — exercised by `feature-741.feature` driving the shell in-process, not by mocking git/gh internals.

### Edge Cases

- **Distinguishing decline from redrive** — the crux. A **closed** tracker → `closed-unmerged` → decline (durable rejection); a **missing** tracker → `no-issue` → redrive/withdraw (crash recovery). The all-state listing is what lets the sweep tell these apart; without it both look identical and the sweep would either loop-re-suggest a rejection or wrongly decline a stranded valid candidate.
- **Blocked issue is open, not closed** — `adw:blocked` promotions keep their tracking issue **open** (the human-escalation artifact); the reconcile classifier must check the blocked label **before** the open/closed branch so an open-but-blocked tracker → `blocked` (decline), not `open` (leave). The decline executor writes `@promotion-declined` to the source file but must **not** close or mutate the tracking issue.
- **Crash between tag-write and issue-file (#740's own order)** — #740 tags then files; a filing crash strands a `suggested` file with no tracker. Next sweep: `suggested` + `no-issue` + still-qualifying → redrive re-files (self-healing). This means redrive doubles as origination-retry — desirable and covered by the `redrive` decider cell.
- **Score drift on a stranded candidate** — `suggested` + `no-issue` + `!meetsThreshold` → withdraw (strip tag). The decider's `meetsThreshold` input (computed by `processCandidate` before the decision) *is* the "re-score first" step US19 asks for — no separate re-score pass needed.
- **Withdraw resumes TTL** — stripping to state `none` makes `isPromotionExempt` return `false`; the sibling `perIssueScenarioSweep` then deletes the file once it is >14d post-merge. Benign re-originate: if a withdrawn file's deterministic score later rises above threshold with no tracker, it re-originates normally (no oscillation — scores are content-deterministic).
- **Decline resumes TTL, terminally** — `@promotion-declined` is terminal (`parsePromotionTagState` precedence: declined wins over a lingering suggestion); next sweep sees `declined` → `leave` forever, and TTL sweeps it normally. Never re-suggested (AC1/AC2, US17).
- **Duplicate trackers across states** — two promotion issues `Promotes: feature-N` (e.g., a redrive filed a second one): lowest-number wins (documented tie-break, reused verbatim). Classify the canonical one.
- **Reconciliation list truncation** — the query caps at `limit: 200`. If promotion issues ever exceed that, a real tracker could be missed → false `no-issue` → spurious redrive (duplicate issue). Realistically the tagged set is tiny; the limit bump from 100→200 and this note document the ceiling. (Pagination is out of scope.)
- **Read-your-write / stale-checkout lag** — if the cron host's default branch is behind origin and a promotion merged in that window, the file may still be listed locally while the tracker is closed → classified `closed-unmerged` → decline. Mitigated by the sweep running on a freshly-pulled default branch (a cron-wiring-slice responsibility; #740/this slice are hand-invokable) and by `defaultTagAndCommit`'s default-branch guard + non-fatal push (a failed push self-heals next sweep). Not gated on `stateReason` (see "Note on `merged`/`done`" — that would strand worse).
- **Non-fatal end-to-end** — every executor (`attemptOriginate`/`attemptRedrive`/`attemptTagWrite`) is try/catch-wrapped and returns a boolean; a transient git/gh error is logged and swallowed, one candidate's failure never aborts the loop nor crashes the (future) cron caller.

## Acceptance Criteria

- A candidate whose promotion PR/issue was **closed unmerged** gets `@promotion-declined` written to its source file and is thereafter never re-suggested (`declined` → `leave` on every future sweep; TTL resumes).
- A candidate whose tracking issue reached **`adw:blocked`** gets `@promotion-declined` on the source file, and the blocked tracking issue is **left intact** (no close, no relabel).
- A candidate **tagged in-flight but with no tracking issue** (stranded) is **re-filed** (one new `#734`-shaped `adw:feature`/`regression-promotion`/`hitl` issue carrying `Promotes: feature-N`) when it still scores **≥ threshold**.
- A stranded candidate that now scores **below threshold** is **withdrawn** — the `@promotion-suggested-*` tag is stripped (state `none`), TTL resumes, and no issue is filed.
- The decider remains **pure** (no I/O) and its new lifecycle branches are **unit-tested exhaustively** — the full `{tagState} × {meetsThreshold} × {reconcile}` cross-product plus named edges (decline-closed, decline-blocked, redrive, withdraw).
- Zero regressions: existing #740 originate/leave/done behaviour, the `perIssueScenarioSweep` promotion-exemption composition, and every other caller of `listOpenIssuesCmd` are unaffected (default `--state open` preserved).
- `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run build`, `bun run test:unit`, and the `@adw-741` + `@regression` scenario suites all pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun install` — ensure dependencies are present (no new libraries are introduced by this feature).
- `bun run lint` — lint the changed TypeScript for quality/style issues.
- `bunx tsc --noEmit` — type-check the repository.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional ADW type-check (validates the widened `PromotionIssueRef`/`reconcileFactFor`, the extended `PromotionAction` handling in the shell, and the `ListOpenIssuesOptions.state` option).
- `bun run build` — verify the build succeeds.
- `bun run test:unit` — run the Vitest unit suite; confirm the extended `promotionSweepDecider`, `promotionReconcileLink`, and new `issueCommands` command-builder tests pass with zero regressions across the ~1600-test suite.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-741"` — run this feature's BDD acceptance scenarios (decline-closed, decline-blocked, redrive, withdraw, non-fatal, type-check backstop).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — run the regression suite to confirm no promotion-related regression scenario reddens.

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`): the decider and reconcile classifier stay **pure** (same input → same output, no I/O); side effects (git/gh) live only in the shell's injected seams. Use **guard clauses / early returns** (max nesting depth ~2) in the decider and the `processCandidate` action switch. Treat data as **immutable** — `serializePromotionTagState` already returns new content and never mutates. Keep every touched file **under 300 lines** (see Task 11's extraction fallback for `promotionSweep.ts`). No decorators.
- **No new libraries.** Everything reuses #740's modules (`promotionTagState`, `promotionIssueBody`, `promotionReconcileLink`, `promotionSweepDefaults`) and the existing `gitContext`/`labelManager`. If a dependency were ever needed, `.adw/commands.md` specifies `bun add <package>` — not required here.
- **Scope boundaries (out of scope, deferred to sibling PRD slices):**
  - **Cron interval-gate wiring (US25).** `runPromotionSweep` is still hand-invokable (`bunx tsx adws/triggers/promotionSweep.ts`); wiring `cycleCount % PROMOTION_SWEEP_INTERVAL_CYCLES === 0` into `trigger_cron.ts` (adjacent to the already-wired `runPerIssueScenarioSweep`) is a later slice — this feature adds no `trigger_cron.ts` change.
  - **Deleting the dead promotion modules** (`promotionCommenter`, `promotionMover`, `promotionApprovalDetector`, `adwPromotionSweep.tsx`) and rewriting the README "Scenario Promotion" section (PRD US23) — a separate cleanup slice.
  - **The pipeline changes** (`scenarioPhase` skip-gate for `regression-promotion` issues, the advisory rot-comment PR step) — separate slices; not needed for the reconcile lifecycle.
  - **First-run backlog re-scoring (US21)** falls out naturally once the sweep is cron-wired (each backlog `@promotion-suggested-*` file reconciles to `no-issue` → redrive-if-qualifying / withdraw-if-not), but is not separately built here.
- **Why `merged`/`done` stay decider-only:** see the "Note on `merged`/`done`" section — the shell never emits `merged` because a promoted file leaves `features/per-issue/` and is not listed; "done" is realised by absence (US15), matching #740's precedent that `done` is declared-but-shell-unreachable. Gating decline on `stateReason: COMPLETED` is deliberately avoided (it would strand a "closed-as-completed-but-not-merged" file).
- **Minor rename honesty:** `listOpenPromotionIssues`/`openIssues` → `listPromotionIssues`/`promotionIssues` because the listing is now all-state; these are internal names on #740's un-shipped-to-cron modules, so the rename is contained (no external callers). `ListOpenIssuesOptions` keeps its name (adding a `state` option is minimal and backward-compatible; renaming the method + all call sites would be gratuitous churn).
- **Self-healing invariant preserved:** like `perIssueScenarioSweep`, a failed persist/file leaves the local commit/tag for the next sweep to reconcile; decline and withdraw are idempotent (re-serializing the same terminal/none state yields byte-identical content, so `addAndCommitPaths` makes no redundant commit).
