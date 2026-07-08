# Feature: TTL-sweep promotion-awareness (root-cause fix)

## Metadata
issueNumber: `739`
adwId: `ne2we8-ttl-sweep-promotion`
issueJson: `{"number":739,"title":"TTL-sweep promotion-awareness (root-cause fix)","body":"## Parent PRD\n\n`specs/prd/automated-scenario-promotion-sweep.md` (PR #738)\n\n## What to build\n\nMake the 14-day per-issue scenario sweep promotion-aware so that scenarios under active promotion consideration are never deleted out from under a maintainer. Add a pure `promotionTagState` module that parses/serializes the on-file markers `@promotion-suggested-<date>` and `@promotion-declined` (state machine `none → suggested → declined`), and a pure `isPromotionExempt` predicate. Compose these into `perIssueScenarioSweep` so a file tagged `@promotion-suggested-*` is exempt from the age-based deletion, while `@promotion-declined` (and untagged) files are swept normally.\n\nThis is the root cause of \"files with `@promotion-suggested-*` get lost\": `isScenarioStale` is currently age-only and tag-blind. Keep `isScenarioStale` a pure age predicate; exemption is a separate composed predicate. This slice is independently valuable — even a manually-tagged file stops getting lost.\n\nSee PRD sections \"Problem Statement\", \"Solution\", and Implementation Decision \"TTL sweep change\".\n\n## Acceptance criteria\n\n- [ ] A `features/per-issue/feature-N.feature` whose PR merged >14 days ago but which carries `@promotion-suggested-<date>` is NOT deleted by the sweep\n- [ ] The same file, once its tag is `@promotion-declined`, IS deleted by the sweep on the normal 14-day TTL\n- [ ] An untagged stale file continues to be deleted exactly as today (no behavior change)\n- [ ] `promotionTagState` correctly parses/serializes both markers and the `none → suggested → declined` transitions, idempotently\n- [ ] `isScenarioStale` remains a pure age-only predicate; exemption logic lives in `isPromotionExempt`\n\n## Blocked by\n\nNone - can start immediately\n\n## Touched Files\n\n- adws/triggers/perIssueScenarioSweep.ts\n- adws/core/promotionTagState.ts (new)\n\n## User stories addressed\n\n- User story 3\n- User story 4\n- User story 16\n- User story 17"}`

## Feature Description

The live cron loop deletes each `features/per-issue/feature-{N}.feature` scenario (plus its `step_definitions/feature-{N}.*` siblings) 14 days after the linked PR merged. Today that deletion is decided **purely by age** — `isScenarioStale` in `adws/triggers/perIssueScenarioSweep.ts` never looks at the file's contents. This is the root cause of the PRD's headline complaint: a scenario that a maintainer was invited to promote (marked on-file with `@promotion-suggested-<date>`) silently disappears 14 days after its issue's PR merged, before anyone gets a reviewable moment to keep it.

This feature makes the sweep **promotion-aware**. It introduces a small, pure, dependency-free module — `adws/core/promotionTagState.ts` — that owns the on-file promotion markers `@promotion-suggested-<date>` and `@promotion-declined`, modelling the state machine `none → suggested → declined`. The module exposes:

- `parsePromotionTagState(content)` — reads a feature file's text and returns its promotion state (`none | suggested | declined`).
- `serializePromotionTagState(content, target, opts)` — applies a target state to the file text idempotently (add/replace/strip the marker), preserving all other content byte-for-byte.
- `isPromotionExempt(state)` — the pure exemption predicate: a file is exempt from the age-based sweep **only while `suggested`**; `declined` and `none` (untagged) files are swept normally.

The sweep then **composes** `isPromotionExempt(parsePromotionTagState(fileContent))` into its per-file decision. `isScenarioStale` stays exactly as-is (a pure age-only predicate); exemption is a separate, orthogonal gate layered on top. The net effect: a `@promotion-suggested-*` file is protected from deletion while under consideration, a `@promotion-declined` file ages out on the normal 14-day TTL, and an untagged file behaves exactly as today.

This is the first, independently-valuable slice of the parent PRD (`specs/prd/automated-scenario-promotion-sweep.md`). Even before the automated `runPromotionSweep` (a later slice) writes these markers, a **manually** tagged file already stops getting lost. The `serializePromotionTagState` half of the module is built and unit-tested here so the later sweep slice can consume it, but the marker-*writing* shell is out of scope for this issue — this slice only *reads* the marker to gate deletion.

## User Story

As an ADW maintainer,
I want per-issue scenarios that carry a `@promotion-suggested-<date>` marker to be exempt from the 14-day deletion sweep (and `@promotion-declined` ones to resume ageing out),
So that a scenario under active promotion consideration is never deleted out from under me, while a scenario I've rejected is not kept forever.

## Problem Statement

`adws/triggers/perIssueScenarioSweep.ts::isScenarioStale` decides deletion from **age alone** (`mergedAt`, `retentionDays`, `now`). It is completely blind to file contents. Therefore:

1. A per-issue scenario that scores well and receives a durable `@promotion-suggested-<date>` marker is still deleted 14 days after its PR merged — the exact "files with `@promotion-suggested-*` get lost" failure the PRD calls out (Further Notes → "Root cause restated", item 2).
2. There is no on-file, machine-readable notion of promotion state at all — no parser, no serializer, no exemption predicate — so nothing downstream (this sweep, or the later automated promotion sweep) can reason about which files are in-flight, rejected, or untouched.

The consequence is a governance gap: the maintainer is invited to promote a scenario but the invitation self-destructs before it can be acted on.

## Solution Statement

Introduce a **pure** `promotionTagState` module (no I/O, unit-testable in isolation) that is the single source of truth for the on-file promotion markers and their state machine, and compose its exemption predicate into the existing sweep loop.

- **Keep `isScenarioStale` pure and age-only.** Do not add tag logic inside it. Its signature and behaviour are unchanged, preserving its existing truth-table tests.
- **Add `isPromotionExempt(state)` as a separate composed gate.** In `runPerIssueScenarioSweep`, after a file is found age-stale, read its content, parse the promotion state, and skip deletion iff `isPromotionExempt` returns true. Exemption is checked *only for already-stale files* — fresh files are never read (no new I/O on the common path) and their behaviour is untouched.
- **Model the marker precedence as a terminal state machine.** `declined` is terminal and wins over a lingering `suggested` marker, so a declined file always resumes the normal TTL (matches User Stories 16–17: rejecting a promotion is durable and suppresses re-suggestion).
- **Parse tag *lines* only, not prose.** The parser considers a line only when every whitespace-separated token on it begins with `@` (a Gherkin tag line). This makes it immune to feature descriptions/steps that merely mention `@promotion-suggested-…` as literal text (several existing files do), and it is placement-agnostic across the feature-level and scenario-level tag lines.
- **Fail safe toward preservation.** If a stale file's content cannot be read, the sweep skips deletion for that file (and logs a warning) rather than deleting a file whose promotion state is unknown. This mirrors the module's existing posture — `getMergedAt` returning `null` on error already means "don't delete" — and self-heals on the next sweep.
- **Build the full module now, wire only what this slice needs.** `serializePromotionTagState` (add/replace/strip markers, idempotent round-trips) is implemented and unit-tested here to satisfy acceptance criterion 4 and to be ready for the later `runPromotionSweep` slice, but this issue only wires `parsePromotionTagState` + `isPromotionExempt` into the sweep. No marker is written by this slice.

The `promotionTagState` module lives in `adws/core/` (the home of the repo's other pure decision modules — `resolveVerdict`, `resolveResumeSpawn`, `stageClassifier`, `upgradeFailureCap`) and is **deep-imported** by the sweep (`import { … } from '../core/promotionTagState'`), matching the sweep's existing deep import of `../github/gitContextFactory` and keeping the change scoped to exactly the two files named in the issue's Touched Files (no edit to the shared `adws/core/index.ts` barrel; a barrel re-export can be added by the later consuming slice).

## Relevant Files

Use these files to implement the feature:

- `adws/triggers/perIssueScenarioSweep.ts` — **modify.** The 14-day per-issue sweep. `isScenarioStale` stays age-only; `runPerIssueScenarioSweep` gains the composed exemption gate and a new injectable `readFeatureContent` dep. This is one of the two Touched Files.
- `adws/promotion/promotionTagWriter.ts` — **read-only reference (salvage marker logic).** Existing pure marker helpers (`SUGGESTION_DATE_RE = /@promotion-suggested-(\d{4}-\d{2}-\d{2})/`, tag-block scanning, token removal/insertion, idempotent no-op-on-missing behaviour) to reuse/adapt in the new module. Do **not** modify this file (it belongs to the promotion module slated for deletion in a later PRD slice; this slice only borrows its regex/marker patterns).
- `adws/promotion/types.ts` — **read-only reference.** Shows the existing `TagState` union and marker vocabulary the new `PromotionTagState` type parallels.
- `adws/promotion/scenarioParser.ts` — **read-only reference.** Confirms feature-level vs scenario-level tag-line placement (tags sit on the line immediately above `Feature:` / `Scenario:`), informing where `serializePromotionTagState` writes the feature-level marker.
- `adws/triggers/__tests__/perIssueScenarioSweep.test.ts` — **modify.** Extend with promotion-awareness cases (stale+suggested → kept, stale+declined → deleted, stale+untagged → deleted unchanged, read-error → skip). Follow its existing `deps`-injection + `makeMockCtx` patterns.
- `adws/core/__tests__/resolveVerdict.test.ts` — **read-only reference.** Canonical table-driven pure-module test style to mirror for the new module's tests.
- `adws/core/index.ts` — **read-only reference (do not edit in this slice).** Confirms the barrel-export convention; intentionally left untouched to honour the 2-file Touched Files scope.
- `adws/triggers/trigger_cron.ts` (lines ~212–214) — **read-only reference.** The interval-gated call site (`runPerIssueScenarioSweep()`); confirms the sweep is invoked with default deps, so the new `readFeatureContent` dep must have a working default. No change needed.
- `specs/prd/automated-scenario-promotion-sweep.md` — **read-only reference.** Parent PRD; see "Problem Statement", "Solution", Implementation Decision "TTL sweep change", and the `promotionTagState` / `isPromotionExempt` module descriptions.

### New Files

- `adws/core/promotionTagState.ts` — **new.** The pure promotion-tag-state module. Exports `PromotionTagState` type, `parsePromotionTagState`, `serializePromotionTagState`, and `isPromotionExempt`. No I/O, no imports of git/gh/fs. This is the second Touched File.
- `adws/core/__tests__/promotionTagState.test.ts` — **new.** Table-driven unit tests for the new module (parse, serialize round-trips, idempotency, exemption predicate).

### Conditional Documentation

Per `.adw/conditional_docs.md`, the following existing app-docs are relevant context for this change (read before implementing):

- `app_docs/feature-oobdbg-bdd-cutover-polymorphic-prompts-sweep.md` — condition: "When working with `adws/triggers/perIssueScenarioSweep.ts` or the 14-day per-issue scenario retention sweep" and "When `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES` or the sweep wiring in `trigger_cron.ts` needs context".
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — owns `adws/triggers/perIssueScenarioSweep.ts`.
- `app_docs/feature-28aysq-hitl-label-tag-lifecycle.md` — condition: "When working with the `@promotion-suggested-<date>` tag lifecycle (refresh-date, remove-suggestion, daily suppression)" and the `promotionTagWriter` operations / `detectExistingSuggestionDate` helper.
- `app_docs/feature-tdauam-promotion-commenter-deep-modules.md` — condition: "When troubleshooting `@promotion-suggested-<date>` tag insertion or byte-exact preservation of surrounding feature file content".

## Implementation Plan

### Phase 1: Foundation — the pure `promotionTagState` module

Create `adws/core/promotionTagState.ts` as a self-contained pure module. It must not import `fs`, git, gh, or anything with side effects — only string logic. Salvage the marker regex/token patterns from `adws/promotion/promotionTagWriter.ts` (do not import from it; copy/adapt the small pure patterns so this module has no dependency on the promotion module that a later PRD slice deletes).

Public surface:

- `export type PromotionTagState = 'none' | 'suggested' | 'declined';`
- `export function parsePromotionTagState(content: string): PromotionTagState;`
- `export function serializePromotionTagState(content: string, target: PromotionTagState, opts?: { date?: string }): string;`
- `export function isPromotionExempt(state: PromotionTagState): boolean;`

### Phase 2: Core Implementation — parse, serialize, exempt

Implement the three functions with clear, flat control flow (guard clauses; max ~2 levels of nesting per the coding guidelines):

- **`parsePromotionTagState`** — split content into lines; keep only *tag lines* (trimmed, non-empty, and every whitespace-separated token starts with `@`); collect their tokens. Precedence (terminal state machine): if any token equals `@promotion-declined` → `'declined'`; else if any token matches `/^@promotion-suggested-\d{4}-\d{2}-\d{2}$/` → `'suggested'`; else `'none'`. Exact-token matching (not substring/`includes`) plus tag-line filtering makes it immune to prose mentions of the markers.
- **`serializePromotionTagState`** — applies the target state to the feature-level tag line (the `@…` line directly above the `Feature:` keyword; create one preserving `Feature:` indentation if absent), preserving every non-marker token (`@adw-N`, `@adw-<slug>`, …) and all other file bytes:
  - `target='suggested'` (requires `opts.date`, `YYYY-MM-DD`): strip any existing `@promotion-declined` and any existing `@promotion-suggested-*` token, then append `@promotion-suggested-<date>`. Idempotent for the same date.
  - `target='declined'`: strip any existing `@promotion-suggested-*` token, then append `@promotion-declined` (if not already present). Idempotent.
  - `target='none'`: strip both markers (the withdraw path used by a later slice). Idempotent.
  - Guarantees: round-trip (`parsePromotionTagState(serializePromotionTagState(c, s, {date})) === s`) and idempotency (`serialize(serialize(c, s), s) === serialize(c, s)`).
- **`isPromotionExempt`** — `return state === 'suggested';` (exempt only while suggested; `none` and `declined` are not exempt).

### Phase 3: Integration — compose exemption into the sweep

Modify `adws/triggers/perIssueScenarioSweep.ts`:

1. Add `import * as fs from 'fs';` and `import { parsePromotionTagState, isPromotionExempt } from '../core/promotionTagState';` (deep import; do not touch `../core/index.ts`).
2. Leave `isScenarioStale` **exactly as-is** (pure, age-only). Do not add parameters or tag logic to it.
3. Extend `PerIssueSweepDeps` with `readFeatureContent?: (filePath: string) => string | null;`.
4. Add `defaultReadFeatureContent(filePath: string): string | null` — builds `gitContextForRepo(getRepoInfo())` (mirroring `defaultListFeatures`), reads the working-tree file at `path.join(ctx.basePath, filePath)` via `fs.readFileSync(..., 'utf-8')`, and returns `null` on any error (fail-safe).
5. In `runPerIssueScenarioSweep`, resolve `readFeatureContent = deps?.readFeatureContent ?? defaultReadFeatureContent`. In the per-file loop, **after** the `isScenarioStale(...)` guard returns true and **before** collecting the file for removal, insert an exemption gate (extract to a small named helper to keep the loop body flat):
   - `const content = readFeatureContent(filePath);`
   - If `content === null`: log `"perIssueScenarioSweep: could not read <filePath> to check promotion state — skipping deletion (conservative)"` at `warn` and `continue` (skip deletion; self-heals next sweep).
   - `const state = parsePromotionTagState(content);`
   - If `isPromotionExempt(state)`: log `"perIssueScenarioSweep: <filePath> is promotion-exempt (@promotion-suggested) — not sweeping"` at `info` and `continue`.
   - Otherwise fall through to the existing sibling-collection + `toRemove.push(...)` logic (untagged and `declined` files are swept exactly as today).
6. No change to `defaultPersistRemoval`, `persistRemoval` wiring, or `trigger_cron.ts` — the new dep defaults transparently.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Task 1: Read context and confirm conventions
- Read `README.md`, `.adw/coding_guidelines.md`, and the parent PRD `specs/prd/automated-scenario-promotion-sweep.md` ("Solution", "TTL sweep change").
- Read `adws/triggers/perIssueScenarioSweep.ts`, `adws/promotion/promotionTagWriter.ts`, `adws/promotion/scenarioParser.ts`, and `adws/core/__tests__/resolveVerdict.test.ts` to match existing marker-regex and pure-module test conventions.
- Read the conditional docs listed under "Relevant Files → Conditional Documentation".

### Task 2: Create the pure `promotionTagState` module
- Create `adws/core/promotionTagState.ts` with the `PromotionTagState` type and the three functions specified in Phase 2.
- No `fs`/git/gh/promotion-module imports. Use exact-token matching over tag lines only. Add concise JSDoc noting purity and the terminal `declined` precedence.
- Keep functions flat (guard clauses, max ~2 nesting levels); extract line/tag-token helpers as small named functions.

### Task 3: Unit-test `promotionTagState`
- Create `adws/core/__tests__/promotionTagState.test.ts`.
- `parsePromotionTagState`: untagged → `none`; feature-level `@promotion-suggested-2026-07-08` → `suggested`; `@promotion-declined` → `declined`; both markers present → `declined` (precedence); prose line mentioning `@promotion-suggested-<today>`/`` `@promotion-declined` `` in a Feature description or step → **not** matched (still `none`); marker on a scenario-level tag line still detected.
- `serializePromotionTagState`: `none→suggested` adds the dated marker beside existing `@adw-N` tags; `suggested→declined` strips the dated marker and adds `@promotion-declined`; `→none` strips both; file with no pre-existing tag line gets one created above `Feature:`; non-marker tags and other lines preserved byte-for-byte; round-trip (`parse(serialize(...)) === target`) and idempotency (`serialize(serialize(...)) === serialize(...)`) for each target.
- `isPromotionExempt`: `suggested → true`; `none → false`; `declined → false`.

### Task 4: Compose exemption into the sweep
- Modify `adws/triggers/perIssueScenarioSweep.ts` per Phase 3 (imports, `PerIssueSweepDeps.readFeatureContent`, `defaultReadFeatureContent`, the post-stale exemption gate, `readFeatureContent` resolution). Do **not** modify `isScenarioStale`.

### Task 5: Extend the sweep tests
- Modify `adws/triggers/__tests__/perIssueScenarioSweep.test.ts`:
  - Stale file (`getMergedAt` 20d ago) with `readFeatureContent` returning `@promotion-suggested-<date>` content → **not** in `removed`; `persistRemoval` not called with it; an `info` "promotion-exempt" log emitted.
  - Same file with `readFeatureContent` returning `@promotion-declined` content → **is** in `removed` (swept on TTL).
  - Stale untagged file (`readFeatureContent` returns plain Gherkin, no markers) → **is** in `removed` (no behaviour change vs today).
  - Stale file with `readFeatureContent` returning `null` (read error) → **not** in `removed`; a `warn` "could not read … skipping" log emitted.
  - Confirm a *fresh* (non-stale) suggested file: `readFeatureContent` is **not** consulted for it (exemption only checked after the stale guard) — assert via a `vi.fn()` spy not called for the fresh file's path.
  - Keep and re-run the existing truth-table + integration + default-wiring cases unchanged (regression guard that `isScenarioStale` behaviour and the persist path are untouched).

### Task 6: Validate — zero regressions
- Run every command in "Validation Commands" and ensure each exits cleanly.

## Testing Strategy

### Unit Tests

`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope.

- **`adws/core/__tests__/promotionTagState.test.ts` (new)** — table-driven, mirroring `resolveVerdict.test.ts`. Covers all three parse states + precedence + prose-immunity, all three serialize targets with round-trip and idempotency assertions (assert on the resulting content string / re-parsed state — never on private helpers), and the `isPromotionExempt` truth table. This is the direct unit proof of acceptance criterion 4 and the exemption half of the root-cause fix.
- **`adws/triggers/__tests__/perIssueScenarioSweep.test.ts` (extend)** — inject `readFeatureContent` alongside the existing `listFeatures`/`getMergedAt`/`persistRemoval` deps to assert the composed behaviour: suggested→kept, declined→swept, untagged→swept (unchanged), unreadable→skipped, and fresh-file→content-not-read. Assert on `removed` / `persistRemoval` arguments (externally observable behaviour), not on internal control flow. The pre-existing `isScenarioStale` truth-table cases remain and act as the "age predicate stays pure/unchanged" regression guard (acceptance criterion 5).

### Edge Cases

- File carries **both** `@promotion-suggested-<date>` and `@promotion-declined` → parsed `declined` (terminal wins) → swept. Guards against a malformed/partially-written file leaking forever.
- Prose (Feature description or `Given/When/Then` step text) literally containing `@promotion-suggested-<today>` or `@promotion-declined` → not a tag line → parsed `none` → swept normally (no false exemption). Verified against real files like `features/per-issue/feature-509.feature`/`feature-609.feature` that mention these tokens in prose.
- Malformed/undated `@promotion-suggested` (no `YYYY-MM-DD`) → does not match the dated regex → treated as `none` (not exempt). Only a properly dated suggestion protects a file.
- Stale file whose content is unreadable (`readFeatureContent` → `null`) → skipped, warn-logged, self-heals next sweep (fail-safe toward preservation; consistent with `getMergedAt` null → not stale).
- Fresh (non-stale) file → `readFeatureContent` never invoked (no new I/O on the common path; behaviour identical to today).
- `serializePromotionTagState` applied to a file with no pre-existing tag line → creates one above `Feature:` with matching indentation, preserving the rest.
- Idempotent re-tagging: applying `suggested` (same date) or `declined` twice yields identical content.
- Feature file with only a feature-level tag line and no scenarios → parse/serialize operate on that single tag line without error.

## Acceptance Criteria

- A `features/per-issue/feature-N.feature` whose linked PR merged >14 days ago but which carries `@promotion-suggested-<date>` is **not** returned by `runPerIssueScenarioSweep` and is **not** passed to `persistRemoval`.
- The same file, once its marker is `@promotion-declined`, **is** swept on the normal 14-day TTL (returned + persisted).
- An untagged stale file is swept exactly as today — the pre-existing sweep integration/default-wiring tests still pass unchanged.
- `promotionTagState` parses and serializes both markers and the `none → suggested → declined` transitions with proven round-trip and idempotency (new unit tests green).
- `isScenarioStale` is unchanged (pure, age-only) — its truth-table tests pass without modification; exemption logic lives solely in `isPromotionExempt` / the composed gate.
- `bun run lint`, `bunx tsc --noEmit` (both tsconfigs), `bun run build`, and `bun run test:unit` all pass; the `@adw-739` and `@regression` scenario suites are green.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — Lint the changed TypeScript for style/quality issues.
- `bunx tsc --noEmit` — Type-check the repo (root tsconfig).
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional type-check for the `adws/` project (per `.adw/commands.md` → "Additional Type Checks").
- `bun run build` — Verify no build errors.
- `bun run test:unit` — Run the vitest unit suite (`bun run test:unit`), including the new `promotionTagState.test.ts` and the extended `perIssueScenarioSweep.test.ts`, with zero regressions.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-739"` — Run this feature's BDD scenario(s) authored by the pipeline for issue #739.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run the regression BDD safety net to confirm no cross-feature regressions.

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`): keep `promotionTagState` pure (side effects isolated at the sweep boundary), immutable (return new strings, never mutate inputs), flat (guard clauses, max ~2 nesting levels — extract the exemption gate and tag-token helpers into named functions), strictly typed (`PromotionTagState` union, no `any`), and under 300 lines. No decorators.
- **No new libraries** — string logic only; nothing to install. (`.adw/commands.md` library-install command, for reference: `bun add <package>`.)
- **Scope discipline** — this slice only *reads* the marker to gate deletion. `serializePromotionTagState` is implemented and unit-tested for the later `runPromotionSweep` slice but is **not** wired into any writer here. Do not add a marker-writing path, a cron sweep, or an `adw:feature` issue filer in this issue.
- **Touched-files fidelity** — change is confined to the two files named in the issue (`adws/triggers/perIssueScenarioSweep.ts`, `adws/core/promotionTagState.ts`) plus their co-located test files. Deliberately **not** editing `adws/core/index.ts` (deep import instead) to keep the region tight and avoid overlap with other in-flight issues; a barrel re-export can be added by the later consuming slice.
- **Do not modify `adws/promotion/promotionTagWriter.ts`** — it is reference-only (its module is slated for deletion in a later PRD slice). Copy/adapt only the small pure regex/marker patterns; do not `import` from it, so `promotionTagState` carries no dependency on the doomed promotion module.
- **Fail-safe rationale** — on an unreadable stale file the sweep skips deletion rather than deleting a file of unknown promotion state; this matches the module's existing "null → don't delete" posture (`getMergedAt`) and self-heals on the next sweep. The only cost is a rare untagged file lingering one extra cycle, which is preferable to an unrecoverable wrongful deletion.
- **PRD forward-links** — later slices will add `promotionSweepDecider`, `promotionReconcileLink`, `promotionIssueBody`, `shouldSkipScenarioAuthoring`, and the `runPromotionSweep` shell that writes these markers via `serializePromotionTagState`. This slice deliberately builds the read/serialize primitive they depend on without any of that machinery.
