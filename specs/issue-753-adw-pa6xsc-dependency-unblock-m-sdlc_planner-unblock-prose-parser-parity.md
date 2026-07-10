# Bug: Dependency unblock misses prose `blocked by #N` — dependents strand when blocker merges

## Metadata
issueNumber: `753`
adwId: `pa6xsc-dependency-unblock-m`
issueJson: `{"number":753,"title":"Dependency unblock misses prose `blocked by #N` — dependents strand when blocker merges","body":"## Summary\n\n`handleIssueClosedDependencyUnblock` (adws/triggers/webhookGatekeeper.ts:182) fails to\nre-evaluate a dependent issue when its blocker closes, if the dependency was declared as\nprose (e.g. `- blocked by #28`) rather than under a `## Blocked by` heading. The dependent\nstrands: it was correctly deferred at creation but is never unblocked.\n\n## Root cause (verified)\n\nDetection and unblock answer \"who depends on #X\" with **different parsers**:\n\n- Defer/detection: `findOpenDependencies` → `extractDependencies` → `parseKeywordProximityDependencies`\n  — 80-char keyword-proximity lookback (issueDependencies.ts:105-111). Matches prose `- blocked by #28`.\n- Unblock: `handleIssueClosedDependencyUnblock` → `parseDependencies` (webhookGatekeeper.ts:182)\n  — heading-only (`## Dependencies|Depends on|Blocked by`, issueDependencies.ts:50-52). Does NOT\n  match a bare bullet → `\"No issues depend on closed issue #N\"` → dependent never unblocks.\n\nObserved: vestmatic-research #29 (`- blocked by #28`) deferred correctly at 2026-07-09 13:32,\nthen on #28's merge at 14:49 the unblock logged \"No issues depend on closed issue #28\". #29 stranded.\n\n## What to build\n\n- Refactor `handleIssueClosedDependencyUnblock` to select dependents via `extractDependencies`\n  (the same extractor detection uses), replacing the narrow `parseDependencies` call at :182.\n  Run it over all open issues (unbounded is accepted).\n- Add a DI seam to the function (inject the open-issue lister, dependency extractor, eligibility\n  check, and spawn) mirroring the `issueOpenedRouter.ts` pure-decision + DI pattern, so the flow\n  is testable without real `gh`.\n\n## Acceptance criteria\n\n- [ ] An open issue whose body declares a prose dependency (`- blocked by #N`, no heading) is\n      selected as a dependent when #N closes, and its eligibility is re-evaluated / spawned.\n- [ ] Heading-based deps (`## Blocked by`) continue to unblock (no regression).\n- [ ] `handleIssueClosedDependencyUnblock` accepts injectable collaborators; a unit test drives\n      the prose case RED→green with the extractor + spawn mocked.\n- [ ] A per-issue `@adw-{issueNumber}` BDD scenario drives the unblock decision **in-process**\n      (injected collaborators, no real `gh`/`listOpenIssues`).\n- [ ] `closeAbandonedDependents` (:249) is intentionally left unchanged.\n\n## Out of scope\n\n- `closeAbandonedDependents` parser (deliberately narrow; failing-to-close is the safe direction).\n- Cron backstop for unblock (unblock remains webhook-only).\n- `adw:none` PRD opt-out — already works on the webhook-opened and cron-fresh paths; no code needed.\n- Retroactive rescue of #29 (its blocker already closed; recover manually).\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-07-10T11:30:10Z","comments":[],"actionableComment":null}`

## Bug Description

When a blocking issue closes (its PR merges), ADW's webhook `issues.closed` handler is supposed to
find every open issue that was deferred because it depended on the now-closed issue, re-check its
eligibility, and spawn its workflow. This "unblock" step runs through
`handleIssueClosedDependencyUnblock` (`adws/triggers/webhookGatekeeper.ts:170`).

**Symptom.** A dependent issue that declared its blocker as *prose* — a bare bullet such as
`- blocked by #28`, with no `## Blocked by` heading — is correctly **deferred** at creation but is
**never unblocked** when its blocker closes. It strands indefinitely (an operator must manually
re-trigger it with a fresh `## continue` comment).

**Expected vs actual.**
- *Expected:* whichever way a dependency is written, if detection deferred the dependent, the same
  declaration must unblock it when the blocker closes (parser parity between defer and unblock).
- *Actual:* detection uses a broad keyword-proximity parser (matches prose), but unblock uses a
  narrow heading-only parser (misses prose). The unblock step logs
  `No issues depend on closed issue #N` and returns without spawning the dependent.

**Verified reproduction of the asymmetry** (run in this worktree):

```
$ bunx tsx -e "import {parseDependencies, parseKeywordProximityDependencies} from './adws/triggers/issueDependencies.ts'; const b='- blocked by #28'; console.log('unblock parser:', JSON.stringify(parseDependencies(b))); console.log('detection core:', JSON.stringify(parseKeywordProximityDependencies(b)));"
unblock parser: []          # heading-only → misses prose → dependent stranded
detection core: [28]        # proximity → matches prose → dependent was deferred
```

## Problem Statement

`handleIssueClosedDependencyUnblock` selects dependents with `parseDependencies(issue.body)`
(`webhookGatekeeper.ts:182`), a heading-only parser. Detection (`findOpenDependencies` →
`extractDependencies` → `parseKeywordProximityDependencies`) uses a broad proximity parser that also
matches prose. The two paths therefore disagree about "who depends on #X": detection defers a
prose-dependent issue, but unblock cannot find it, so the issue is deferred forever.

A secondary problem is **testability**: `handleIssueClosedDependencyUnblock` hard-wires its
collaborators (`gitContextForRepo(...).listOpenIssues`, `parseDependencies`, `checkIssueEligibility`,
`classifyAndSpawnWorkflow`), so the unblock *decision* cannot be driven in a unit test or an
in-process BDD scenario without real `gh`. The BDD harness cannot drive real `gh`/`listOpenIssues`
(see the harness-observability constraints), so a DI seam is required to prove the fix.

## Solution Statement

Give the unblock path **parser parity** with detection and a **DI seam**, mirroring the existing
`issueOpenedRouter.ts` pure-decision + dependency-injection pattern:

1. Extract the unblock flow into a new sibling module `adws/triggers/issueClosedUnblockRouter.ts`
   (mirroring `issueOpenedRouter.ts`, which lives outside `webhookGatekeeper.ts` and imports
   `classifyAndSpawnWorkflow` from it — a **one-way** edge, so no import cycle is introduced).
   The module exposes:
   - a **pure** decision helper `selectDependents(issuesWithDeps, closedIssueNumber)` (the mirror of
     `decideIssueOpenedRoute`);
   - a `DependencyUnblockDeps` interface injecting the four collaborators (open-issue lister,
     dependency **extractor**, eligibility check, spawn) plus a logger;
   - `buildDefaultDependencyUnblockDeps(repoInfo, gitContext?)` wiring the real collaborators —
     crucially, the extractor default is `extractDependencies` (the detection extractor), **not**
     `parseDependencies`;
   - `handleIssueClosedDependencyUnblock(...)` as the DI orchestration (keeping the exported name so
     callers only change an import path).
2. Delete `handleIssueClosedDependencyUnblock` (and its now-unused `checkIssueEligibility` import)
   from `webhookGatekeeper.ts`. **Leave `closeAbandonedDependents` (:240–:274) exactly as-is** — it
   deliberately keeps the narrow `parseDependencies` (failing to auto-close is the safe direction).
3. Repoint the two callers (`webhookHandlers.ts` import, `trigger_webhook.ts` re-export) at the new
   module. Behaviour and signature are unchanged, so `IssueClosedDeps`/`webhookHandlers` wiring and
   the `issues.closed` branch selection (abandoned/discarded → close, else → unblock) are untouched.
4. Prove it with a unit test (`issueClosedUnblockRouter.test.ts`, prose RED→green with the extractor
   + spawn injected) and an in-process `@adw-753` BDD scenario.

Because unblock is webhook-only and fires once per close event, running the extractor over every open
issue is accepted (the grilled decision). Cost is bounded in practice: `extractDependencies`'
in-memory cache and proximity fast-path mean the LLM fallback fires only for issues whose `#N`
references the proximity parser can't fully account for; a lone `- blocked by #28` resolves on the
fast path with no LLM call.

## Steps to Reproduce

1. Create issue **#28** (a normal blocker) and issue **#29** whose body contains the *prose* line
   `- blocked by #28` (no `## Blocked by` heading).
2. On #29's `issues.opened`, detection (`checkIssueEligibility` → `findOpenDependencies` →
   `extractDependencies`) matches `#28` via the proximity parser and defers #29 with reason
   `open_dependencies` — **correct**.
3. Merge #28's PR so #28 closes. The webhook `issues.closed` handler
   (`handleIssueClosedEvent` → `handleIssueClosedDependencyUnblock`) lists open issues and filters
   them with `parseDependencies(#29.body)` → `[]` (heading-only misses the bullet).
4. **Bug:** the handler logs `No issues depend on closed issue #28` and returns. #29 is never
   re-evaluated and never spawned — it strands.

Fast, deterministic proof of the underlying asymmetry (no GitHub needed):

```
bunx tsx -e "import {parseDependencies, parseKeywordProximityDependencies} from './adws/triggers/issueDependencies.ts'; const b='- blocked by #28'; console.log('unblock parser:', JSON.stringify(parseDependencies(b))); console.log('detection core:', JSON.stringify(parseKeywordProximityDependencies(b)));"
# unblock parser: []   detection core: [28]
```

## Root Cause Analysis

Two code paths answer the same question — "which open issues depend on #X?" — with **different
parsers**, and only detection uses the broad one:

- **Defer / detection** (`adws/triggers/issueEligibility.ts:34` →
  `adws/triggers/issueDependencies.ts:185` `findOpenDependencies` →
  `:131` `extractDependencies` → `:87` `parseKeywordProximityDependencies`): scans the **whole body**
  for `#N` references preceded within ~80 chars by a dependency keyword (`blocked by`, `depends on`,
  …). Matches `- blocked by #28`. Falls back to an LLM extractor only when the proximity parse finds
  fewer refs than the total `#N` count.
- **Unblock** (`adws/triggers/webhookGatekeeper.ts:182` `parseDependencies`,
  `adws/triggers/issueDependencies.ts:46`): only reads inside a `## Dependencies | ## Depends on |
  ## Blocked by` heading section (`:50-52`). A bare bullet with no heading yields `[]`.

Because the unblock filter is strictly narrower than the defer filter, there exists a class of issues
— prose dependencies with no heading — that detection **can defer** but unblock **can never
release**. The declaration that was strong enough to block the issue is invisible to the code meant
to unblock it. `closeAbandonedDependents` shares the same narrow parser, but that is *intentionally*
left narrow: under-matching there means "fail to auto-close," which is the safe direction.

The fix is to make unblock use the **same extractor detection uses** (`extractDependencies`), closing
the parity gap, and to introduce a DI seam so the decision is drivable without real `gh`.

## Relevant Files

Use these files to fix the bug:

- `adws/triggers/webhookGatekeeper.ts` — **edit.** Holds `handleIssueClosedDependencyUnblock`
  (:170-205, the buggy `parseDependencies` call at :182) and `closeAbandonedDependents` (:240-274).
  Move the unblock function out to the new module; drop the now-unused `checkIssueEligibility`
  import; keep `parseDependencies`, `gitContextForRepo`, `LOGS_DIR`, `classifyAndSpawnWorkflow`
  (still used by `closeAbandonedDependents` / other exports). **Do not touch `closeAbandonedDependents`.**
- `adws/triggers/issueDependencies.ts` — **read (no change).** Source of both parsers.
  `extractDependencies` (:131, the detection extractor to adopt; cache + proximity fast-path + LLM
  fallback), `parseKeywordProximityDependencies` (:87), `parseDependencies` (:46, the narrow one).
- `adws/triggers/issueOpenedRouter.ts` — **read (pattern to mirror).** Canonical pure-decision
  (`decideIssueOpenedRoute`) + DI (`IssueOpenedRouterDeps`, `buildDefaultIssueOpenedRouterDeps`,
  `routeIssueOpened`) template. Note it imports `classifyAndSpawnWorkflow` from `webhookGatekeeper.ts`
  one-way (no cycle) — replicate exactly.
- `adws/triggers/issueEligibility.ts` — **read (no change).** `checkIssueEligibility` /
  `EligibilityResult`, injected as the eligibility collaborator.
- `adws/triggers/webhookHandlers.ts` — **edit (import only).** `IssueClosedDeps` at :40-49 injects
  `handleIssueClosedDependencyUnblock`; `defaultIssueClosedDeps` (:59-75) supplies it; the
  `issues.closed` branch at :215-218 calls it for non-terminal closes. Only the import at :17 needs
  to be repointed at the new module; the DI shape and branch logic are unchanged.
- `adws/triggers/trigger_webhook.ts` — **edit (re-export only).** Line 37 re-exports
  `handleIssueClosedDependencyUnblock` from `./webhookGatekeeper`; repoint it at the new module.
- `adws/triggers/__tests__/webhookGatekeeper.test.ts` — **edit.** Remove the moved
  `handleIssueClosedDependencyUnblock` describe block (:105-138) and drop it from the import at :52;
  keep the `closeAbandonedDependents` tests (:140-162) and the `parseDependencies` mock.
- `features/per-issue/step_definitions/feature-542.steps.ts` — **read (pattern to mirror).** Reference
  implementation of an in-process, DI-driven per-issue scenario (recording deps, no real `gh`, no
  spawn side effects). The `@adw-753` step defs follow this shape.
- `features/per-issue/feature-542.feature` — **read (pattern to mirror).** Gherkin structure for a
  per-issue `@adw-{N}` acceptance scenario.
- `app_docs/feature-ni6fpk-serialize-overlapping-region-issues.md` — **read (context).** Region-overlap
  serialization registers durable `## Blocked by #N <!-- adw:region-overlap -->` lines that ride this
  exact unblock path; confirms heading-based deps must keep unblocking (no regression).
- `app_docs/feature-9gjajh-webhook-triggers.md` — **read (context).** Webhook trigger / `issues.closed`
  event plumbing that reaches `handleIssueClosedDependencyUnblock`.

### New Files

- `adws/triggers/issueClosedUnblockRouter.ts` — the extracted unblock module: pure `selectDependents`,
  `DependencyUnblockDeps`, `buildDefaultDependencyUnblockDeps`, and the DI `handleIssueClosedDependencyUnblock`.
- `adws/triggers/__tests__/issueClosedUnblockRouter.test.ts` — Vitest unit test proving the prose
  RED→green, heading no-regression, ineligible-stays-blocked, real-parser parity, gitContext routing,
  and no-throw-on-lister-error.
- `features/per-issue/feature-753.feature` — `@adw-753` acceptance scenario (prose unblock + heading
  no-regression + still-blocked, driven in-process).
- `features/per-issue/step_definitions/feature-753.steps.ts` — in-process step defs injecting recording
  collaborators (no real `gh`/`listOpenIssues`/spawn).

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Step 1 — Confirm the defect (establish RED)

- Run the asymmetry repro and confirm `unblock parser: []` vs `detection core: [28]`:
  ```
  bunx tsx -e "import {parseDependencies, parseKeywordProximityDependencies} from './adws/triggers/issueDependencies.ts'; const b='- blocked by #28'; console.log('unblock parser:', JSON.stringify(parseDependencies(b))); console.log('detection core:', JSON.stringify(parseKeywordProximityDependencies(b)));"
  ```
- This documents the exact behaviour the fix must close.

### Step 2 — Create the extracted DI module `adws/triggers/issueClosedUnblockRouter.ts`

Mirror `issueOpenedRouter.ts` (pure decision + DI wrapper). Keep files under 300 lines, prefer guard
clauses, extract the per-dependent branch into a named helper (coding-guideline nesting discipline).

- Imports: `RepoInfo` (type), `GitContext` (type), `log`/`LOGS_DIR`/`LogLevel` from `../core`,
  `extractDependencies` from `./issueDependencies`, `checkIssueEligibility` + `EligibilityResult` from
  `./issueEligibility`, `classifyAndSpawnWorkflow` from `./webhookGatekeeper`, `gitContextForRepo`
  from `../github/gitContextFactory`.
- Types + pure decision:
  ```ts
  export interface OpenIssue { number: number; body: string }
  export interface IssueWithDeps { number: number; body: string; deps: number[] }

  /** Pure mirror of decideIssueOpenedRoute: which extracted issues name the closed issue. */
  export function selectDependents(issues: IssueWithDeps[], closedIssueNumber: number): IssueWithDeps[] {
    return issues.filter((i) => i.deps.includes(closedIssueNumber));
  }
  ```
- DI interface (the four injected collaborators + logger):
  ```ts
  export interface DependencyUnblockDeps {
    listOpenIssues: () => OpenIssue[];
    extractDependents: (issueBody: string, issueNumber: number) => Promise<number[]>;
    checkEligibility: (issueNumber: number, issueBody: string, repoInfo: RepoInfo) => Promise<EligibilityResult>;
    spawn: (issueNumber: number, repoInfo: RepoInfo, targetRepoArgs: string[], gitContext?: GitContext) => Promise<void>;
    logger: (message: string, level?: LogLevel) => void;
  }
  ```
- Default builder — **the parity fix lives here**: `extractDependents` defaults to
  `extractDependencies` (NOT `parseDependencies`):
  ```ts
  export function buildDefaultDependencyUnblockDeps(repoInfo: RepoInfo, gitContext?: GitContext): DependencyUnblockDeps {
    const ctx = gitContext ?? gitContextForRepo(repoInfo);
    return {
      listOpenIssues: () => JSON.parse(ctx.listOpenIssues({ fields: ['number', 'body'], limit: 100 })) as OpenIssue[],
      extractDependents: (body, n) => extractDependencies(body, LOGS_DIR, undefined, undefined, n),
      checkEligibility: checkIssueEligibility,
      spawn: (n, r, a, gc) => classifyAndSpawnWorkflow(n, r, a, undefined, undefined, undefined, gc),
      logger: log,
    };
  }
  ```
- Private per-dependent helper (guard clause keeps the loop body flat):
  ```ts
  async function reEvaluateDependent(
    dependent: IssueWithDeps,
    closedIssueNumber: number,
    repoInfo: RepoInfo,
    targetRepoArgs: string[],
    gitContext: GitContext | undefined,
    deps: DependencyUnblockDeps,
  ): Promise<void> {
    const eligibility = await deps.checkEligibility(dependent.number, dependent.body, repoInfo);
    if (!eligibility.eligible) {
      deps.logger(`Issue #${dependent.number} still ineligible after #${closedIssueNumber} closed: ${eligibility.reason}`);
      return;
    }
    deps.logger(`Issue #${dependent.number} unblocked by closure of #${closedIssueNumber}, spawning workflow`);
    await deps.spawn(dependent.number, repoInfo, targetRepoArgs, gitContext);
  }
  ```
- DI orchestration (keep the exported name; add a trailing optional `deps` param defaulting to the
  builder; sequential extraction avoids concurrent LLM bursts):
  ```ts
  export async function handleIssueClosedDependencyUnblock(
    closedIssueNumber: number,
    repoInfo: RepoInfo,
    targetRepoArgs: string[],
    gitContext?: GitContext,
    deps: DependencyUnblockDeps = buildDefaultDependencyUnblockDeps(repoInfo, gitContext),
  ): Promise<void> {
    try {
      const issues = deps.listOpenIssues();
      const withDeps: IssueWithDeps[] = [];
      for (const issue of issues) {
        const d = await deps.extractDependents(issue.body || '', issue.number);
        withDeps.push({ number: issue.number, body: issue.body || '', deps: d });
      }
      const dependents = selectDependents(withDeps, closedIssueNumber);
      if (dependents.length === 0) {
        deps.logger(`No issues depend on closed issue #${closedIssueNumber}`);
        return;
      }
      deps.logger(`Found ${dependents.length} issue(s) depending on closed issue #${closedIssueNumber}`);
      for (const dependent of dependents) {
        await reEvaluateDependent(dependent, closedIssueNumber, repoInfo, targetRepoArgs, gitContext, deps);
      }
    } catch (error) {
      deps.logger(`Error checking dependents of closed issue #${closedIssueNumber}: ${error}`, 'error');
    }
  }
  ```
- Preserve the existing log strings verbatim (`No issues depend on closed issue #N`, `Found N
  issue(s) depending on closed issue #N`, `Issue #M unblocked by closure of #N, spawning workflow`,
  `Issue #M still ineligible after #N closed: <reason>`, `Error checking dependents of closed issue
  #N: <e>`) so downstream log expectations stay stable.

### Step 3 — Remove the moved function from `webhookGatekeeper.ts`

- Delete `handleIssueClosedDependencyUnblock` (:170-205).
- Remove the now-unused import `import { checkIssueEligibility } from './issueEligibility';` (:21).
- **Verify** `parseDependencies` (:22), `gitContextForRepo` (:30), `LOGS_DIR` (:11), and the
  `GitContext` type import remain — they are still used by `closeAbandonedDependents` /
  `classifyAndSpawnWorkflow` / `ensureCronProcess`.
- **Do not modify `closeAbandonedDependents` (:240-274)** — it keeps `parseDependencies` by design
  (acceptance criterion: :249 unchanged).

### Step 4 — Repoint the two callers at the new module

- `adws/triggers/webhookHandlers.ts:17` — split the import so `handleIssueClosedDependencyUnblock`
  comes from the new module and `closeAbandonedDependents` stays:
  ```ts
  import { closeAbandonedDependents } from './webhookGatekeeper';
  import { handleIssueClosedDependencyUnblock } from './issueClosedUnblockRouter';
  ```
  Leave `IssueClosedDeps` (:48), `defaultIssueClosedDeps` (:73), and the `issues.closed` branch
  (:215-218) unchanged — the injected signature is identical.
- `adws/triggers/trigger_webhook.ts:37` — move `handleIssueClosedDependencyUnblock` out of the
  `./webhookGatekeeper` re-export into a re-export from `./issueClosedUnblockRouter`:
  ```ts
  export { classifyAndSpawnWorkflow, closeAbandonedDependents, ensureCronProcess } from './webhookGatekeeper';
  export { handleIssueClosedDependencyUnblock } from './issueClosedUnblockRouter';
  ```

### Step 5 — Add the unit test `adws/triggers/__tests__/issueClosedUnblockRouter.test.ts`

Drive `handleIssueClosedDependencyUnblock` through the DI seam with recording collaborators (no real
`gh`). Cover:

- **Prose RED→green (primary AC test):** `listOpenIssues` returns `[{ number: 29, body: '- blocked by
  #28' }]`; inject `extractDependents` returning `[28]` for #29's body and `spawn` as a `vi.fn()`;
  `checkEligibility` → `{ eligible: true }`. Assert `spawn` was called once with `(29, REPO_INFO,
  TARGET_ARGS, ...)`. (Against the pre-fix hard-wired `parseDependencies`, no seam existed and #29
  was never selected — this test only passes once the extractor is injected and used.)
- **Real-parser parity (regression guard against reverting to heading-only):** inject
  `extractDependents: (body) => parseKeywordProximityDependencies(body)` (the detection core, sync,
  offline) over `body: '- blocked by #28'`; assert #29 is spawned. Add a sibling asserting the same
  body through `parseDependencies` selects nothing — pinning *why* the swap matters.
- **Heading no-regression:** `body: '## Blocked by\n- #28'`, `extractDependents` → `[28]`; assert #29
  spawned.
- **Still-blocked:** `checkEligibility` → `{ eligible: false, reason: 'open_dependencies',
  blockingIssues: [30] }`; assert `spawn` NOT called and the "still ineligible" log path taken.
- **No dependents:** `extractDependents` → `[]` for every issue; assert `spawn` not called (and the
  "No issues depend on…" branch).
- **gitContext routing via `buildDefaultDependencyUnblockDeps`:** passing a `gitContext` uses its
  `listOpenIssues` and does not call `gitContextForRepo`; omitting it falls back to
  `gitContextForRepo(repoInfo)` (port the two moved assertions from `webhookGatekeeper.test.ts`).
- **No-throw on lister error:** `listOpenIssues` throws → the call resolves without throwing and logs
  the error (port from the moved block).

Follow the existing `vi.hoisted` + module-mock conventions used in `webhookGatekeeper.test.ts` /
`issueOpenedRouter.test.ts`.

### Step 6 — Update `adws/triggers/__tests__/webhookGatekeeper.test.ts`

- Remove `handleIssueClosedDependencyUnblock` from the import at :52.
- Delete the `describe('handleIssueClosedDependencyUnblock — listOpenIssues routing', …)` block
  (:105-138) — its coverage now lives in the new test file.
- Keep the `closeAbandonedDependents` describe block (:140-162) and the `parseDependencies` mock; the
  `./issueEligibility` mock (:24) is now unused by this file and may be removed for hygiene.

### Step 7 — Add the in-process `@adw-753` BDD scenario

- `features/per-issue/feature-753.feature`, tagged `@adw-753`, with a `Background: Given the ADW
  codebase is checked out` and scenarios that drive the unblock decision in-process:
  1. *Prose dependency is unblocked when its blocker closes* — an open issue with body `- blocked by
     #28` (no heading) is selected and spawned when #28 closes, while an unrelated open issue is
     neither re-evaluated nor spawned.
  2. *Heading dependency still unblocks (no regression)* — an open issue with a `## Blocked by`
     section referencing #28 is selected and spawned.
  3. *One closure unblocks both a prose and a heading dependent while skipping an unrelated issue* —
     a single blocker's closure spans both declaration styles in one pass and stays selective
     (AC1 + AC2 together).
  4. *Still-blocked dependent is not spawned* — a dependent that is selected and re-evaluated but
     remains ineligible (another open blocker) is not spawned.
  5. *TypeScript type-check passes* (mirror feature-542's final scenario if that step is registered).
- `features/per-issue/step_definitions/feature-753.steps.ts` — mirror `feature-542.steps.ts`:
  - `Before`/`After({ tags: '@adw-753' })` reset per-scenario state (recorded spawns, seeded open
    issues).
  - Build recording `DependencyUnblockDeps`: `listOpenIssues` returns the scenario's seeded issue
    set; `extractDependents` uses the **real** `extractDependencies` (or, for a fully hermetic offline
    run, `parseKeywordProximityDependencies`) so the scenario proves genuine parser parity on prose
    bodies; `checkEligibility` returns eligible unless the scenario marks the issue still-blocked;
    `spawn` pushes `{ issueNumber }` into a recorded array; `logger` is a no-op.
  - Craft seeded bodies so the proximity fast-path fully resolves (single `#N` prose ref), so no LLM
    or network call occurs — keeping the harness hermetic (aligns with the BDD-harness observability
    limits: no real `gh`/`listOpenIssues`).
  - `When` a blocker `#N` closes → call `handleIssueClosedDependencyUnblock(N, repoInfo, [],
    undefined, recordingDeps)`.
  - `Then` assert the expected dependent was / was not recorded as spawned. Every assertion reads a
    runtime artefact (the recorded spawn), never source-file text (rot-prevention rule).

### Step 8 — Validate

- Run every command in **Validation Commands** and confirm zero failures and zero regressions.
- Re-run the Step 1 repro is no longer necessary for pass/fail, but confirm the new unit test and the
  `@adw-753` scenario are green, and the full `@regression` suite is unaffected.

## Validation Commands

Execute every command; all must exit 0.

- `bunx tsx -e "import {parseDependencies, parseKeywordProximityDependencies} from './adws/triggers/issueDependencies.ts'; const b='- blocked by #28'; console.log('unblock parser:', JSON.stringify(parseDependencies(b))); console.log('detection core:', JSON.stringify(parseKeywordProximityDependencies(b)));"`
  — documents the root-cause asymmetry (`[]` vs `[28]`) that the fix closes.
- `bunx vitest run adws/triggers/__tests__/issueClosedUnblockRouter.test.ts` — the new unit test
  (prose RED→green + parity + no-regression + routing + no-throw) passes.
- `bunx vitest run adws/triggers/__tests__/webhookGatekeeper.test.ts adws/triggers/__tests__/webhookHandlers.test.ts` — the trimmed gatekeeper tests and the untouched handler wiring still pass.
- `bun run lint` — no lint errors (no unused imports left in `webhookGatekeeper.ts` / test file).
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes (no import cycle, signatures intact).
- `bun run test:unit` — full unit suite passes with zero regressions.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-753"` — the new in-process acceptance
  scenario passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite is
  unaffected (heading-based unblock and region-overlap `## Blocked by` behaviour unchanged).
- `bun run build` — build succeeds.

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`): keep the new module under 300 lines; isolate
  side effects behind the DI seam and keep `selectDependents` pure; use guard clauses and the
  extracted `reEvaluateDependent` helper to hold nesting at ≤2; remove unused imports (code hygiene).
  No new library is required — the fix reuses `extractDependencies`, so the install command
  (`bun add <package>`) is not needed.
- **Why a new module rather than an in-place `deps` param:** it faithfully mirrors
  `issueOpenedRouter.ts` (a sibling module that imports `classifyAndSpawnWorkflow` from
  `webhookGatekeeper.ts` one-way), keeps both files under the 300-line ceiling, and — critically —
  avoids introducing the codebase's first `webhookGatekeeper ↔ router` import cycle. The exported
  name `handleIssueClosedDependencyUnblock` is preserved, so callers change only an import path.
- **`extractDependencies` vs `parseKeywordProximityDependencies`:** the default extractor is
  `extractDependencies` (the full detection extractor: cache → proximity → LLM fallback) for exact
  parity with defer. Its LLM fallback fires only when the proximity parse can't account for every
  `#N` in a body; a lone `- blocked by #N` resolves on the offline fast path.
- **Cost is accepted (grilled decision):** unblock is webhook-only and runs once per close event;
  running the extractor over all open issues (`limit: 100`, unchanged) is acceptable, and the
  in-memory cache bounds repeat cost. No cron backstop is added (out of scope).
- **`closeAbandonedDependents` stays narrow on purpose** — under-matching there means "fail to
  auto-close," the safe direction (acceptance criterion + out-of-scope).
- **`adw:none` opt-out** needs no code here — it already works on the webhook-opened
  (`issueOpenedRouter`) and cron-fresh paths.
- **No retroactive rescue** of the original stranded dependent (its blocker already closed); recover
  it manually with a fresh `## continue` comment now the webhook/tunnel are back up.
- **Conditional-docs index caveat:** `.adw/conditional_docs.md` references several dependency/webhook
  app_docs (e.g. `feature-91v6qi-llm-dependency-extraction.md`) that are **absent** from this
  worktree (stale index). Only `feature-ni6fpk-serialize-overlapping-region-issues.md` and
  `feature-9gjajh-webhook-triggers.md` exist and are cited above. Do not block on the missing files.
