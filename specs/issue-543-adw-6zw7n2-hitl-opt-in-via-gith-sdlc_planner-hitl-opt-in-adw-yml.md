# Feature: HITL opt-in for framework-upgrade PRs via `.github/adw.yml`

## Metadata
issueNumber: `543`
adwId: `6zw7n2-hitl-opt-in-via-gith`
issueJson: `{"number":543,"title":"HITL opt-in via .github/adw.yml","body":"## Parent PRD\n\n`specs/prd/adw-init-hash-and-label-classification.md`\n\n## What to build\n\nRead `.github/adw.yml` on the target repo to determine whether the upgrade PR should auto-merge (default) or require human review (opt-in). Config field lives outside `.adw/` so the LLM regen cannot clobber it.\n\nSee the \"Solution\" section of the parent PRD and user story 9.\n\n## Acceptance criteria\n\n- [ ] `.github/adw.yml` absent or `hitl: false` → upgrade PR auto-merges\n- [ ] `.github/adw.yml` with `hitl: true` → upgrade PR does NOT auto-merge; awaits human review\n- [ ] Malformed `.github/adw.yml` falls back to default (auto-merge) with a warning log\n- [ ] Tests cover the three config states\n\n## Blocked by\n\n- Blocked by #541\n\n## User stories addressed\n\n- User story 8\n- User story 9","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-08T11:11:32Z","comments":[],"actionableComment":null}`

## Feature Description

The versioned auto-(re)init system (parent PRD `adw-init-hash-and-label-classification.md`) regenerates a target repo's `.adw/` directory when the framework's content hash advances. The regeneration orchestrator `adwUpgrade.tsx` (built in #541) checks out the `adw-upgrade-<hash>` claim branch, runs `/adw_init` via the Claude CLI, writes the fresh hash to `.adw-version`, commits, and **opens a PR linking the `adw:upgrade` tracking issue**. Per #541's plan, `adwUpgrade.tsx` has **no merge step** — it opens the PR and exits.

This feature adds the missing merge decision. By default (User Story 8) the upgrade PR should auto-merge so target repos stay current without operator intervention. But some target repos want a human to review framework regenerations before they land (User Story 9). The opt-in signal is a small config file, `.github/adw.yml`, on the target repo with a `hitl: true` field.

Critically, the signal **lives outside `.adw/`** (mirroring the rationale for `.adw-version`): `/adw_init` regenerates the entire `.adw/` directory, so any opt-in stored inside `.adw/` would be clobbered by the very regeneration it is meant to gate. `.github/adw.yml` is never touched by the LLM regen, so the operator's choice survives every upgrade.

Behaviour:
- `.github/adw.yml` absent, or present with `hitl: false` → upgrade PR auto-merges (default).
- `.github/adw.yml` with `hitl: true` → upgrade PR is **not** merged; it is left open for a human to review and merge. The tracking issue stays open (and its dependents stay blocked) until the human merges, at which point the existing `Implements #<issueNumber>` linkage auto-closes the tracking issue and the existing CRON dependency-closure unblocks dependents — identical to the auto-merge path, just human-paced.
- `.github/adw.yml` present but malformed → fall back to the default (auto-merge) and emit a warning log. A misconfigured file must never wedge the upgrade pipeline.

## User Story

As the framework operator
I want to opt in to human review of framework-upgrade PRs per target repo via a config file outside `.adw/` (`.github/adw.yml` with `hitl: true`)
So that the LLM regeneration of `.adw/` cannot clobber my opt-in signal, and upgrades I care about wait for my review while everything else stays current automatically.

## Problem Statement

`adwUpgrade.tsx` opens the upgrade PR but never merges it (confirmed: #541's plan states "adwUpgrade has no merge step"). There is also no cron/`adwMerge.tsx` path that picks up the `adw:upgrade` tracking issue for merge — `adwUpgrade.tsx` writes no workflow state and posts no `adwId` workflow comment, so the cron's stage resolver (`cronStageResolver.ts`) never derives `awaiting_merge` for it. Consequently:

1. The PRD's "PR auto-merges by default" behaviour (User Story 8) is unimplemented — upgrade PRs sit open indefinitely.
2. There is no mechanism for an operator to request human review of an upgrade PR (User Story 9).
3. Any merge gating cannot be stored inside `.adw/`, because `/adw_init` regenerates `.adw/` wholesale and would erase it.

## Solution Statement

Two coordinated changes, both contained within the upgrade orchestrator's already-established dependency-injection seam:

1. **New deep module `adws/core/adwYmlConfig.ts`** — mirrors the existing `adws/core/adwVersion.ts` sibling (the `.adw-version` reader, which lives outside `.adw/` for the exact same reason). It exposes `readAdwYmlConfig(worktreePath): AdwYmlConfig` returning `{ hitl: boolean }`. Absent file → `{ hitl: false }` (no warning). Present with a recognizable `hitl: true|false` → that value. Present but the `hitl` value is not a recognizable boolean, or the file cannot be read → `{ hitl: false }` plus a `warn` log. The parser is a minimal, hand-rolled, line-based reader for the single `hitl:` scalar — consistent with the codebase's existing convention of hand-parsing config files (`core/projectConfig.ts` parses `.adw/*.md` by hand) and avoids adding a YAML dependency for one boolean field. The reader is structured behind a clean interface so it can be swapped for a real YAML parser later if the config grows (see Notes).

2. **Add a gated merge step to `adwUpgrade.tsx`** — after the PR is opened (the existing final step of `executeUpgrade`), read `.github/adw.yml` from the upgrade worktree. If `hitl` is `false` (the default for absent/`false`/malformed), merge the PR via the existing `mergePR` primitive (`adws/github/prApi.ts`, already exported from `./github` and already imported by `adwUpgrade.tsx`). If `hitl` is `true`, skip the merge, post a non-workflow comment noting the PR awaits human review, and exit cleanly with the PR left open. Both the config reader and the merge function are injected through the existing `UpgradeDeps` interface, so the decision logic is unit-testable with no real filesystem, git, or network — exactly as the rest of `executeUpgrade` already is.

The merge is **best-effort**: a merge failure (e.g. branch protection, required CI, a race) is non-fatal — it logs a warning, posts a non-workflow comment on the tracking issue, leaves the PR open, and still returns a `completed` outcome (the orchestrator's core job — regenerate + open PR — succeeded). This matches the PRD's documented failure mode ("PR auto-merge blocked … `#UPG` PR sits open; operator expedites").

## Relevant Files

Use these files to implement the feature:

- `adws/adwUpgrade.tsx` — **Primary change.** `executeUpgrade` gains the gated merge step after PR open; `UpgradeDeps` gains `readAdwYmlConfig` and `mergePR`; `buildDefaultUpgradeDeps` wires the production implementations; `buildUpgradeFailureComment`-style helper(s) for the HITL-deferred and merge-failed non-workflow comments. New result `reason` values are added (the existing `outcome` union is unchanged).
- `adws/core/adwVersion.ts` — **The structural template to mirror** for the new module. Same shape: a small deep module reading a single root-level file outside `.adw/`, with `FILENAME` const + reader/writer, and explicit absent-vs-present handling. Copy its docstring rationale (file lives outside `.adw/` so LLM regen cannot clobber it).
- `adws/core/projectConfig.ts` — **Parsing-convention reference.** Shows how the codebase hand-parses config files (`parseMarkdownSections`, `parseUnitTestsEnabled`: `key.split(':')…trim().toLowerCase()`). Mirror this minimal line-based style for the `hitl:` scalar; do not introduce a parser dependency.
- `adws/core/index.ts` — Register the new module's exports next to the existing `adwVersion` export (line ~210, `export { ADW_VERSION_FILENAME, readAdwVersion, writeAdwVersion } from './adwVersion';`).
- `adws/github/prApi.ts` — Provides `mergePR(prNumber, repoInfo): { success: boolean; error?: string }` (the `gh pr merge --merge` wrapper). The merge primitive to inject. Already exported via `adws/github/index.ts`.
- `adws/providers/types.ts` — `PullRequestResult` has both `url` and `number` (line 161–164). `createPullRequest` already returns the PR `number`; capture it for the merge call (today only `pr.url` is read).
- `adws/__tests__/adwUpgrade.test.ts` — **Extend and update.** Add `readAdwYmlConfig` and `mergePR` to the `makeDeps` stub; add tests for the three config states (merge called / not called / called-on-malformed). Update the existing success-path assertions that currently expect `reason === 'pr_opened'` and "never calls commentOnIssue on success" to reflect the new default-path behaviour (default now also merges; reason changes — see Step-by-Step Tasks).
- `adws/adwMerge.tsx` and `adws/phases/autoMergePhase.ts` — **Read-only reference** for the existing `hitl` *label* gate (a separate mechanism from this `.github/adw.yml` config gate). Read them to keep terminology and the "stateless, log-only defer" style consistent; do not modify them.
- `adws/triggers/autoMergeHandler.ts` — **Read-only reference.** Provides `mergeWithConflictResolution(...)` — the heavier, conflict-resolving merge primitive used by `adwMerge.tsx`/`autoMergePhase.ts`. Documented in Notes as the alternative to `mergePR` if conflict handling is later required.
- `specs/prd/adw-init-hash-and-label-classification.md` — Parent PRD. See "Solution", the "`adwUpgrade.tsx` orchestrator" implementation decision ("PR auto-merges by default; opt-in HITL is signaled by `.github/adw.yml`"), the "Hash storage on target repos" rationale (the outside-`.adw/` mirror), and User Stories 8 & 9.

### Conditional Documentation (from `.adw/conditional_docs.md`)
- `app_docs/feature-n9880l-adwversion-read-write-module.md` — Conditions match: "working on the versioned auto-(re)init system", "the `.adw-version` file … outside `.adw/`", "implementing the `initializeWorkflow()` hash comparison or `adwUpgrade.tsx` write-back". Directly informs the sibling deep-module pattern this feature mirrors.
- `app_docs/feature-nrr167-hitl-label-gate-adwmerge.md` — Conditions match: "working with the `hitl` label gate in `adwMerge.tsx` or `autoMergePhase.ts`". Read to distinguish the existing `hitl` *label* gate from this new `.github/adw.yml` *config* gate and keep them conceptually separate.
- `app_docs/feature-fygx90-hitl-label-gate-automerge.md` — Conditions match: "label-based gates in the auto-merge flow", "the `hitl` label is present and auto-merge is expected to be skipped". Reference for the established skip-and-defer style.

### New Files
- `adws/core/adwYmlConfig.ts` — Deep module: `ADW_YML_RELATIVE_PATH`, `AdwYmlConfig` interface, `readAdwYmlConfig(worktreePath)`, and an exported pure `parseAdwYml(content)` for direct unit testing.
- `adws/core/__tests__/adwYmlConfig.test.ts` — Fixture/tmp-dir tests for the reader and pure parser (mirrors `adws/core/__tests__/adwVersion.test.ts`).

## Implementation Plan

### Phase 1: Foundation — the config reader deep module
Create `adws/core/adwYmlConfig.ts` as a small, pure-where-possible deep module that turns `.github/adw.yml` into an `AdwYmlConfig`. Model it on `adwVersion.ts`: a `FILENAME`/`RELATIVE_PATH` constant, a typed return shape, explicit absent handling, and a docstring explaining the outside-`.adw/` rationale. Split the I/O (`readAdwYmlConfig`, reads the file) from the pure logic (`parseAdwYml`, string → config) so the parser is testable without a filesystem. Export from `core/index.ts`.

### Phase 2: Core Implementation — gate the merge in the upgrade orchestrator
Extend `UpgradeDeps` with `readAdwYmlConfig` and `mergePR`. In `executeUpgrade`, after the PR is opened, capture the PR number, read the config from the worktree, and branch: `hitl: true` → skip merge + post a non-workflow "awaits human review" comment + return `completed`/`pr_opened_hitl`; otherwise → call `mergePR`, returning `completed`/`pr_merged` on success or `completed`/`merge_failed` (with a non-workflow comment) on failure. Wire production implementations in `buildDefaultUpgradeDeps`.

### Phase 3: Integration — tests, exports, docs
Add the new-module test file; extend and correct the `adwUpgrade.test.ts` suite for the three config states and the updated default-path behaviour; ensure the `core/index.ts` export is consumed cleanly by `adwUpgrade.tsx`. Update the README "Framework auto-upgrade" bullet to mention the `.github/adw.yml` `hitl` opt-in. Run all validation commands.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Create the `adwYmlConfig` deep module
- Create `adws/core/adwYmlConfig.ts`.
- Add a file-level docstring explaining: this reads `.github/adw.yml` at the target repo's worktree root to determine the framework-upgrade auto-merge policy; the file lives **outside `.adw/`** so `/adw_init` regeneration of `.adw/` cannot clobber it (mirror the `adwVersion.ts` rationale and cite the parent PRD).
- Export `const ADW_YML_RELATIVE_PATH = path.join('.github', 'adw.yml');`.
- Export `interface AdwYmlConfig { readonly hitl: boolean; }` with a doc comment: `hitl: true` means the upgrade PR requires human review (no auto-merge); default is `false`.
- Define a module-private `const DEFAULT_CONFIG: AdwYmlConfig = { hitl: false };`.
- Implement and export a pure `parseAdwYml(content: string): AdwYmlConfig`:
  - Locate the top-level `hitl:` scalar by scanning lines: ignore blank lines and full-line comments (`#…`); for a line matching `^\s*hitl\s*:\s*(.*)$`, take the captured value, strip an inline `# …` comment, trim, and strip surrounding single/double quotes.
  - If no `hitl:` key is present → return `DEFAULT_CONFIG` (not malformed; the file may legitimately omit it).
  - If the normalized value (lowercased) is `true` → `{ hitl: true }`; if `false` → `{ hitl: false }`.
  - Otherwise (value present but not a recognizable boolean, e.g. `maybe`) → emit `log(\`adw.yml: malformed 'hitl' value "<raw>", defaulting to auto-merge (hitl: false)\`, 'warn')` and return `DEFAULT_CONFIG`.
- Implement and export `readAdwYmlConfig(worktreePath: string): AdwYmlConfig`:
  - Build `filePath = path.join(worktreePath, ADW_YML_RELATIVE_PATH)`.
  - If `!fs.existsSync(filePath)` → return `DEFAULT_CONFIG` (no warning; absence is the common case).
  - Read the file inside `try/catch`; on read error → `log(... 'warn')` and return `DEFAULT_CONFIG`.
  - Return `parseAdwYml(content)`.
- Import `log` the way sibling core modules do — `import { log } from './utils';` (as `core/upgradeClaim.ts` does; `utils` re-exports it from `logger.ts`).

### 2. Export the new module from `core/index.ts`
- Add, next to the existing `adwVersion` export (~line 210):
  `export { ADW_YML_RELATIVE_PATH, readAdwYmlConfig, parseAdwYml } from './adwYmlConfig';`
  `export type { AdwYmlConfig } from './adwYmlConfig';`

### 3. Write unit tests for the config reader/parser
- Create `adws/core/__tests__/adwYmlConfig.test.ts`, mirroring `adwVersion.test.ts` (use `mkdtempSync`/`writeFileSync`/`rmSync`, `afterEach` cleanup; create the `.github/` subdir before writing `adw.yml`).
- Cover, at minimum, the three acceptance states plus edges:
  - Absent file → `{ hitl: false }`.
  - `hitl: false` → `{ hitl: false }`.
  - `hitl: true` → `{ hitl: true }`.
  - File present but no `hitl:` key (e.g. a different field) → `{ hitl: false }`.
  - Malformed value `hitl: maybe` → `{ hitl: false }` (assert via the pure `parseAdwYml`).
  - Tolerance edges via `parseAdwYml`: quoted (`hitl: "true"`), uppercase (`hitl: TRUE`), inline comment (`hitl: true # gate`), surrounding whitespace.

### 4. Extend `UpgradeDeps` and the default-deps factory in `adwUpgrade.tsx`
- Import `mergePR` by adding it to the existing `from './github'` import; import `readAdwYmlConfig` (and the `AdwYmlConfig` type) by adding to the existing `from './core'` import.
- Add to `interface UpgradeDeps`:
  - `readonly readAdwYmlConfig: (worktreePath: string) => AdwYmlConfig;`
  - `readonly mergePR: (prNumber: number, repoInfo: RepoInfo) => { success: boolean; error?: string };`
- Wire both in `buildDefaultUpgradeDeps`: `readAdwYmlConfig,` and `mergePR: (prNumber, info) => mergePR(prNumber, info),` (or `mergePR` directly).

### 5. Add helper(s) for the new non-workflow comments
- Add `buildUpgradeHitlComment(prNumber: number, adwId: string): string` and `buildUpgradeMergeFailedComment(prNumber: number, reason: string, adwId: string): string`.
- Both MUST be **non-workflow** comments: no line starting with `## :emoji: ` and no `<!-- adw-bot -->` marker, so `isAdwComment()` returns `false` and the concurrency guard does not count the tracking issue as in-progress (same contract as the existing `buildUpgradeFailureComment`). Keep the wording short and operator-actionable (HITL: "This upgrade PR awaits human review per `.github/adw.yml` (`hitl: true`). Review and merge PR #N to apply."; merge-failed: include the truncated error and "merge PR #N manually").

### 6. Add the gated merge step to `executeUpgrade`
- After the existing PR-open step, change `const pr = deps.createPullRequest({...})` handling to also retain `pr.number`.
- Read config: `const cfg = deps.readAdwYmlConfig(worktreePath);`
- If `cfg.hitl === true`:
  - `deps.log(\`adwUpgrade: hitl opt-in via .github/adw.yml — leaving PR #${pr.number} for human review\`, 'info');`
  - `deps.commentOnIssue(issueNumber, buildUpgradeHitlComment(pr.number, adwId), repoInfo);`
  - `return { outcome: 'completed', reason: 'pr_opened_hitl', prUrl: pr.url };`
- Else (default — absent/`false`/malformed):
  - `const merge = deps.mergePR(pr.number, repoInfo);`
  - On `merge.success`: `deps.log(\`adwUpgrade: PR #${pr.number} auto-merged\`, 'success'); return { outcome: 'completed', reason: 'pr_merged', prUrl: pr.url };`
  - On failure: `deps.log(\`adwUpgrade: auto-merge failed for PR #${pr.number} (non-fatal): ${merge.error}\`, 'warn'); deps.commentOnIssue(issueNumber, buildUpgradeMergeFailedComment(pr.number, merge.error ?? 'unknown', adwId), repoInfo); return { outcome: 'completed', reason: 'merge_failed', prUrl: pr.url };`
- Keep `UpgradeRunResult.outcome` as `'completed' | 'failed'` (unchanged); only `reason` strings are added. The `main()` exit logic (`process.exit(result ? 0 : 1)`) is unchanged: a best-effort merge failure is still a clean exit (the PR is open and visible).
- Update the orchestrator's top-of-file workflow docstring to mention the new gated-merge step and the `.github/adw.yml` opt-in.

### 7. Update and extend `adws/__tests__/adwUpgrade.test.ts`
- In `makeDeps`, add stubs: `readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: false }),` and `mergePR: vi.fn().mockReturnValue({ success: true }),`.
- Update existing success-path tests that now change behaviour:
  - The test asserting `reason).toBe('pr_opened')` → update to `'pr_merged'` (default path now merges).
  - "never calls commentOnIssue on success" → still valid for the **default merge-success** path (no issue comment on success); keep it, but ensure the default `mergePR` stub returns success so no merge-failed comment fires.
  - Keep the `createPullRequest`/`writeAdwVersion`/branch-derivation assertions as-is.
- Add new tests:
  - **hitl:false (default) → auto-merge:** with default deps, assert `deps.mergePR` called once with `(pr.number, REPO_INFO)`, result `reason === 'pr_merged'`, and `commentOnIssue` not called.
  - **hitl:true → no auto-merge:** override `readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: true })`; assert `deps.mergePR` **not** called, result `reason === 'pr_opened_hitl'`, and exactly one `commentOnIssue` whose body is **not** an ADW comment (`isAdwComment(body) === false`).
  - **malformed → default auto-merge:** the module-level test (Step 3) already proves malformed→`{hitl:false}`; here assert the orchestrator behaves identically to the hitl:false path when `readAdwYmlConfig` returns `{ hitl: false }` (merge called). Optionally add a focused parser assertion that `parseAdwYml('hitl: maybe\n')` returns `{ hitl: false }`.
  - **merge failure non-fatal:** override `mergePR: vi.fn().mockReturnValue({ success: false, error: 'required status check pending' })`; assert result `outcome === 'completed'`, `reason === 'merge_failed'`, one non-workflow `commentOnIssue`, and that no throw escapes.

### 8. Update README documentation
- In `README.md`, update the "Framework auto-upgrade" bullet (under "What it does") to note: the upgrade PR auto-merges by default, and a target repo can require human review by committing `.github/adw.yml` with `hitl: true` (kept outside `.adw/` so regeneration cannot clobber it).

### 9. Run the Validation Commands
- Run every command in the `Validation Commands` section below and ensure all pass with zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope.

- **`adwYmlConfig` (new module) — `adws/core/__tests__/adwYmlConfig.test.ts`:** Test external behaviour only (file-in → config-out), fixture-driven via temp dirs, mirroring `adwVersion.test.ts`. Asserts the absent/`false`/`true`/missing-key/malformed states and the tolerance edges (quotes, case, inline comment, whitespace). The pure `parseAdwYml` carries the parsing-edge assertions; `readAdwYmlConfig` carries the absent-file and file-present assertions.
- **`adwUpgrade` decision logic — `adws/__tests__/adwUpgrade.test.ts` (extended):** Using the established injected-`UpgradeDeps` pattern (no real fs/git/network/LLM), assert the merge gate: default → `mergePR` called and `reason: 'pr_merged'`; `hitl: true` → `mergePR` not called, `reason: 'pr_opened_hitl'`, one non-ADW comment; merge failure → `completed`/`merge_failed`, non-fatal. The malformed state is exercised at the module level (returns `{ hitl: false }`) and flows through the default path.

### Edge Cases
- `.github/adw.yml` absent (the overwhelmingly common case) → default auto-merge, no warning log.
- `hitl` key present but value is a non-boolean (`maybe`, `1`, empty) → default + warning.
- `hitl` value quoted (`"true"`) or differently cased (`TRUE`) → parsed correctly.
- `hitl: true` with an inline trailing comment (`hitl: true # require review`) → parsed as `true`.
- File present with unrelated keys but no `hitl:` → default, no warning (file isn't "malformed", it just doesn't set the field).
- File unreadable (permissions) on an existing path → default + warning, no crash.
- `hitl: true` but PR later approved/merged by a human → tracking issue auto-closes via `Implements #N`; dependents unblock through existing CRON dependency-closure (no new code needed).
- Default path but `mergePR` fails (branch protection / required CI / race) → non-fatal: warning + non-workflow comment + PR left open + `completed` outcome.

## Acceptance Criteria
- [ ] `.github/adw.yml` absent → `readAdwYmlConfig` returns `{ hitl: false }`; `executeUpgrade` calls `mergePR` and returns `reason: 'pr_merged'`.
- [ ] `.github/adw.yml` with `hitl: false` → same as absent (auto-merge).
- [ ] `.github/adw.yml` with `hitl: true` → `executeUpgrade` does **not** call `mergePR`, posts one non-workflow "awaits human review" comment, and returns `reason: 'pr_opened_hitl'` with the PR left open.
- [ ] Malformed `.github/adw.yml` (non-boolean `hitl` value, or unreadable file) → `readAdwYmlConfig` returns `{ hitl: false }` **and** emits a `warn` log; `executeUpgrade` auto-merges.
- [ ] The `hitl: true` / merge-failed comments are non-ADW comments (`isAdwComment()` returns `false`).
- [ ] Unit tests cover the three config states (absent/`false`, `true`, malformed) at both the module and orchestrator levels.
- [ ] `.github/adw.yml` parsing introduces **no** new runtime dependency (hand-rolled parser, consistent with `projectConfig.ts`).
- [ ] All validation commands pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun install` — Ensure dependencies are present (no new dependency is expected to be added by this feature).
- `bun run lint` — Lint for code-quality issues.
- `bunx tsc --noEmit` — Root type check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check passes.
- `bun run test:unit` — Full unit suite passes, including the new `adwYmlConfig.test.ts` and the extended `adwUpgrade.test.ts`.
- `bun run build` — Build succeeds with no errors.
- Targeted run while iterating: `bunx vitest run adws/core/__tests__/adwYmlConfig.test.ts adws/__tests__/adwUpgrade.test.ts`.

## Notes
- `.adw/coding_guidelines.md` was not found in this repo at planning time; if present at implementation time, strictly adhere to it (fall back to `guidelines/coding_guidelines.md`). General house style to follow: deep modules with a clean interface, dependency injection for I/O (as `UpgradeDeps` already does), no decorators, mirror existing patterns rather than inventing new ones.
- **No new dependency.** The repo has no YAML parser and hand-parses all other config (`core/projectConfig.ts`). For one boolean field, a minimal line-based parser is simplest, keeps the supply-chain surface (`depaudit`) unchanged, and matches convention. The reader is deliberately structured (`readAdwYmlConfig` I/O wrapper + pure `parseAdwYml`) so a real YAML library (`yaml`) can be dropped in behind the same interface if `.github/adw.yml` grows more fields — install command would be `bun add yaml` per `.adw/commands.md`. Recommendation: stay hand-rolled for this issue.
- **Why the merge happens inside `adwUpgrade.tsx` (not via cron/`adwMerge.tsx`):** `adwUpgrade.tsx` is on the "exception list" — it writes no `awaiting_merge` workflow state and posts no `adwId` workflow comment, so the cron stage resolver never routes the `adw:upgrade` tracking issue to `adwMerge.tsx`. Wiring that cron path would be a much larger change and is out of scope. Performing the gated merge in-process is the minimal, self-contained implementation that satisfies the acceptance criteria, and it keeps the orchestrator shallow.
- **Merge primitive choice:** `mergePR` (plain `gh pr merge --merge`) is recommended — the upgrade branch is freshly created off the current default branch, so a clean merge is the overwhelming common case, and `mergePR` is already exported from `./github` (already imported), keeping the change minimal. If conflict handling is ever needed (default branch advancing during a slow HITL window — the PRD's accepted "recursive-churn"), swap to `mergeWithConflictResolution` from `adws/triggers/autoMergeHandler.ts` (used by `adwMerge.tsx`/`autoMergePhase.ts`), which adds `/resolve_conflict`-agent retries at the cost of needing `logsDir`/`specPath` wiring.
- **This `.github/adw.yml` `hitl` config is distinct from the `hitl` GitHub *label*.** The label gates the normal bug/feature/chore `awaiting_merge` path in `adwMerge.tsx`/`autoMergePhase.ts` (stateless, per-issue, re-evaluated each cron tick). The config gates only the framework-**upgrade** PR and is read from the target repo's worktree. Keep the two mechanisms conceptually and lexically separate in code and comments to avoid future confusion.
- **Tracking-issue lifecycle is unchanged by the HITL path.** Whether ADW auto-merges or a human merges later, the PR body's `Implements #<issueNumber>` linkage auto-closes the tracking issue on merge, and the existing CRON dependency-closure unblocks dependents. No additional state management is required for the deferred case.
- **Future consideration:** when the cron→`adwMerge` path is eventually extended to cover upgrade tracking issues (if ever), this in-process gate should be revisited so the `.github/adw.yml` read happens in exactly one place. For now there is a single merge site for upgrades (`executeUpgrade`).
