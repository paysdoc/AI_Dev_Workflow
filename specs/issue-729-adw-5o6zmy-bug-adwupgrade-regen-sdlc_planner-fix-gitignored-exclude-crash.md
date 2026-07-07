# Bug: adwUpgrade regen commit crashes on gitignored exclude path (double-exclusion)

## Metadata
issueNumber: `729`
adwId: `5o6zmy-bug-adwupgrade-regen`
issueJson: `{"number":729,"title":"bug: adwUpgrade regen commit crashes on gitignored exclude path (double-exclusion)","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-07-07T12:31:22Z"}`

## Bug Description

`adwUpgrade` crashes at the step where it commits the regenerated `.adw/` directory. The
orchestrator runs an `git add` scoped by an `:(exclude)` pathspec and git aborts with exit 1:

```
git add -A -- '.' ':(exclude).claude/commands/adw_init.md'
The following paths are ignored by one of your .gitignore files:
.claude/commands/adw_init.md
hint: Use -f if you really want to add them.
```

**Expected behaviour:** the regen commit is created, carrying the real `.adw/` changes and
excluding the copied `.claude/commands/adw_init.md`, and the upgrade proceeds to push + PR.

**Actual behaviour:** `GitContext.commitChanges` throws, `adwUpgrade` crashes, and the `#UPG`
issue is left in a state with no automatic recovery (a failed upgrade is not re-driven —
tracked separately as feature #730, which is Blocked by this bug).

This is a recurrence: the same crash stranded vestmatic `#200` on 2026-06-24 and adwId `72nhdz`
on 2026-07-07. A temporary fix applied on 2026-06-24 was left uncommitted and evaporated. **No
test currently guards this path**, which is why the regression went undetected — the whole point
of this issue is to land the fix *with* a durable unit test and an executable `@regression`
scenario so it cannot silently regress again.

## Problem Statement

When an `excludePaths` entry passed to `commitOps.commitChanges` names a path that is **also
gitignored** in the worktree, the generated `:(exclude)` pathspec promotes `git add -A` into an
explicit-pathspec add, and git refuses to add the gitignored path (exit 1). The crash must be
eliminated **without removing the exclude mechanism**, because in the tracked/self-host case the
same path is *not* gitignored and the exclude does real, necessary work (it holds
`.claude/commands/adw_init.md` out of the upgrade commit to prevent a self-reverting upgrade).

## Solution Statement

Make the exclude ignore-safe inside `adws/gitContext/commitOps.ts`. Before building the
`:(exclude)` pathspec, ask git which of the `excludePaths` are already gitignored in `cwd`
(`git check-ignore <paths>`) and drop those entries. The pathspec is then built only from the
surviving (committable) paths, and the *same* filtered pathspec is used for both
`git status --porcelain` and `git add -A` so the status check and the stage stay consistent
(preserving the documented invariant).

Rationale, verified by reproduction:
- `git add -A` on its own already skips gitignored files, so naming a gitignored path in the
  exclude is **redundant** — dropping it changes nothing about what gets staged.
- Naming it in the exclude is the **sole crash cause**, so dropping it removes the crash.
- Where the path is tracked/committable (self-host: `.claude/commands/adw_init.md` is committed,
  `git check-ignore` exits non-zero → "not ignored"), the entry survives the filter and the
  exclude keeps working exactly as before.

`git check-ignore` exits non-zero when **none** of the given paths are ignored; the injected
runner surfaces that non-zero exit as a throw. Treat any failure as "nothing ignored" (keep every
path) so the filter can never behave worse than today's baseline.

## Steps to Reproduce

Reproduced in a throwaway repo (confirmed 2026-07-07). The crux is that `git status` tolerates the
exclude pathspec on a gitignored path but `git add` does not:

```sh
TMP=$(mktemp -d)
git -C "$TMP" init -q
git -C "$TMP" config user.email t@t.co && git -C "$TMP" config user.name t
printf 'dist/\n.claude/commands/adw_init.md\n' > "$TMP/.gitignore"
mkdir -p "$TMP/.claude/commands" "$TMP/.adw"
printf 'seed\n' > "$TMP/.adw/project.md"
git -C "$TMP" add .gitignore .adw/project.md && git -C "$TMP" commit -qm seed

# Simulate the regen: modify a TRACKED .adw file + create the GITIGNORED command file
printf 'regen\n' > "$TMP/.adw/project.md"
printf 'IGNORED\n' > "$TMP/.claude/commands/adw_init.md"

# 1) status with the exclude pathspec: exit 0, silently omits the ignored path (why commitOps.ts:37 passes)
git -C "$TMP" status --porcelain -- '.' ':(exclude).claude/commands/adw_init.md'   # ->  M .adw/project.md   (exit 0)

# 2) add -A with the SAME pathspec: exit 1, "paths are ignored" (the crash at commitOps.ts:39)
git -C "$TMP" add -A -- '.' ':(exclude).claude/commands/adw_init.md'                # -> exit 1

# 3) check-ignore lists the ignored subset (exit 0); non-ignored path -> exit 1 (runner throws)
git -C "$TMP" check-ignore .claude/commands/adw_init.md                             # -> prints path,   exit 0
git -C "$TMP" check-ignore .adw/project.md                                          # -> empty,         exit 1

# 4) after dropping the exclude, plain add -A still skips the ignored file (exit 0, ignored file NOT staged)
git -C "$TMP" add -A -- '.'                                                          # -> exit 0; status shows only M .adw/project.md
```

In the live product the failing command is issued by `GitContext.commitChanges` →
`commitOps.commitChanges` at `git add -A${suffix}` (`adws/gitContext/commitOps.ts:39`), driven by
`adwUpgrade.tsx:366` passing `excludePaths: ['.claude/commands/adw_init.md']`. The path becomes
gitignored one line earlier via `copyAdwInitCommandToWorktree` (`adws/phases/worktreeSetup.ts:157`).

Note: this does **not** reproduce on the ADW `dev` branch, where `.claude/commands/adw_init.md` is
tracked (not gitignored) — the crash only occurs in target-repo upgrade worktrees where the copied
file is untracked **and** gitignored.

## Root Cause Analysis

1. `copyAdwInitCommandToWorktree` (`adws/phases/worktreeSetup.ts:152-159`) copies the framework's
   `.claude/commands/adw_init.md` into the upgrade worktree so `/adw_init` resolves, then calls
   `ensureGitignoreEntry(worktreePath, '.claude/commands/adw_init.md')` to keep it out of the PR.
   The file is now **untracked and gitignored**.
2. `adwUpgrade.tsx:366` commits the regen with
   `commitChanges(msg, worktreePath, { excludePaths: ['.claude/commands/adw_init.md'] })` to
   *also* exclude the same file at commit time (belt-and-braces; necessary in the self-host case
   where the file is tracked and not ignored).
3. `commitOps.pathspecSuffix` (`adws/gitContext/commitOps.ts:29-33`) turns that into
   ` -- '.' ':(exclude).claude/commands/adw_init.md'`, appended to **both**
   `git status --porcelain` and `git add -A`.
4. `git status --porcelain` with that pathspec exits 0 (it silently omits the ignored path), so the
   "anything to commit?" guard at `commitOps.ts:37` passes. But `git add -A` with the **same**
   pathspec treats the explicit `:(exclude)` mention of a gitignored path as an explicit add of an
   ignored file and aborts with exit 1. The default runner (`execSync` wrapper,
   `gitContext.ts:49-60`) throws, and `commitChanges` propagates the throw → `adwUpgrade` crashes.

The exclude mechanism itself is correct and must be preserved; it is only unsafe when the excluded
path is *already* gitignored, where the exclude is redundant. The fix filters those redundant
entries out before the pathspec is built.

## Relevant Files

Use these files to fix the bug:

- `adws/gitContext/commitOps.ts` — **the fix site.** `pathspecSuffix` and `commitChanges` live
  here. Add the ignore-safe filter (via `git check-ignore`) and route both status + add through the
  filtered pathspec. This directory (`adws/gitContext`) is the git-guard's `EXEMPT_PACKAGE_DIR`, so
  raw `git ...` command strings — including the new `git check-ignore` — are allowed here and will
  not trip `bun run lint:git-guard`.
- `adws/gitContext/gitContext.ts` — context only. Confirms the runner wiring
  (`commitChanges` at line 191 forwards `(cmd, cwd) => this.#run(cmd, { cwd })` into
  `commitOps.commitChanges`) and that the default `exec` is a thin `execSync` wrapper (lines 49-60)
  that throws on non-zero exit — the behaviour the "check-ignore exits non-zero when none ignored"
  branch relies on. No change needed.
- `adws/adwUpgrade.tsx` — context only (the crashing caller, line 366). No change needed; the fix
  is entirely inside `commitOps`. The existing `deps.commitChanges` seam already lets
  `adws/__tests__/adwUpgrade.test.ts` mock this call, so no upgrade-orchestrator test changes are
  required.
- `adws/phases/worktreeSetup.ts` — context only (`copyAdwInitCommandToWorktree` at line 152 is what
  makes the path gitignored). No change needed; it is used *as-is* (phase-import) by the regression
  scenario.
- `features/regression/vocabulary.md` — **do NOT auto-edit (human-gated).** `.adw/scenarios.md`
  declares all three regression-contract sections (`Per-Issue Scenario Directory`,
  `Regression Scenario Directory`, `Vocabulary Registry`), so per its embedded contract the agent
  **never auto-promotes `@regression` and never auto-registers vocabulary** — that is a maintainer
  decision. The scenario is authored under `features/per-issue/` (below); its novel Given/When/Then
  phrases are **surfaced to the maintainer in the build Output** for registration if/when the
  scenario is promoted, not written into `vocabulary.md` by the agent.
  <!-- ADW-WARNING: Issue Tests §2 + Acceptance ask for a "@regression scenario" with "vocabulary phrases registered". `.adw/scenarios.md` (all three regression-contract sections present) mandates the agent NEVER auto-promote to @regression or auto-register vocabulary — promotion is a human decision. These cannot both be satisfied automatically. Resolution: the behavioural scenario is authored under features/per-issue/ (tagged @adw-729, NOT @regression) and keeps the exact commit-tree assertions the issue requires; the @regression promotion + vocabulary registration are surfaced to the maintainer in Output. The build agent must NOT tag the scenario @regression or edit features/regression/vocabulary.md. -->
- `features/per-issue/step_definitions/feature-729.steps.ts` — **new (edit).** Step definitions
  carry the scenario's temp worktree path and captured commit outcome in **module-scoped `let`
  state reset in `Before`/`After` hooks** (the `feature-685.steps.ts` §D pattern), **not** in shared
  `RegressionWorld` fields. No edit to `features/regression/step_definitions/world.ts` is required;
  import the `RegressionWorld` **type** only if a typed `this` binding is wanted.
- `cucumber.js` — context only. Confirms the `paths` glob includes `features/per-issue/**/*.feature`
  and the `import` glob includes `features/per-issue/step_definitions/**/*.ts` — so the per-issue
  `feature-729.feature` + `feature-729.steps.ts` below are auto-discovered and run under
  `--tags "@adw-729"`. (The scenario is **not** `@regression`, so the `@regression` run does not
  include it.)
- `features/per-issue/step_definitions/feature-685.steps.ts` — context only (**the pattern to
  mirror**). Its Part D drives the real `commitOps.commitChanges(realRun, …)` over a **real temp git
  repo built with bare `execSync('git …')`** (`initGitRepo` helper: `git init` / `git config`),
  then asserts the produced commit via `git show --name-only --format= HEAD`. Per-issue scenarios do
  **not** use the `@regression` `Before` hook / `setupMockInfrastructure()` / `REAL_GIT_PATH`; they
  shell out to real git directly. The scenario never pushes, so no remote mock is needed.
- `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` — **conditional doc (matched).**
  Owns `adws/gitContext/commitOps.ts` + `adws/adwUpgrade.tsx` + `adws/phases/worktreeSetup.ts`;
  conditions include "When `commitChanges` `excludePaths` option or the upgrade regen scoped-commit
  behaviour is relevant." Documents the existing invariant that the exclude pathspec applies to
  **both** `git status --porcelain` and `git add -A` "so the check and the stage are always
  consistent," and that no-opts callers are byte-identical. The fix must preserve both invariants
  (it does: the filtered pathspec is shared by status + add, and callers with no `excludePaths` hit
  a zero-cost early return with no behaviour change). The document phase should update this doc to
  note the new ignore-safe filtering step.

### New Files
- `adws/gitContext/__tests__/commitOps.test.ts` — unit test with a fake `run` (there is no existing
  `commitOps.test.ts`; `commitChanges` is currently uncovered at the ops level).
- `features/per-issue/feature-729.feature` — the behavioural scenario file (**already authored by
  the scenario writer**), tagged `@adw-729 @adw-5o6zmy-bug-adwupgrade-regen` (per-issue placement per
  `.adw/scenarios.md`; **not** `@regression`). Two scenarios over a real temp git repo, phase-import
  over the real `copyAdwInitCommandToWorktree` + `GitContext.commitChanges`: §1 the gitignored-exclude
  RED→GREEN driver, §2 the tracked-exclude guard. The build agent implements the step definitions for
  the phrases this file already declares (do not move or re-tag the file).
- `features/per-issue/step_definitions/feature-729.steps.ts` — dedicated step definitions
  (module-scoped state; mirrors `feature-685.steps.ts` §D) + a `@adw-729`-scoped `After`
  teardown for the temp worktree.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Fix `commitOps.ts` to make the exclude pathspec ignore-safe

- In `adws/gitContext/commitOps.ts`, add two small helpers above `commitChanges`:
  - `gitignoredSubset(run: Runner, cwd: string, paths: readonly string[]): ReadonlySet<string>` —
    returns the gitignored subset of `paths`. Guard: if `paths.length === 0` return an empty set.
    Build space-joined single-quoted tokens (`paths.map(p => `'${p}'`).join(' ')`) and run
    `git check-ignore <tokens>` via the injected runner. Split stdout on newlines, trim, drop
    empties, return as a `Set`. Wrap the call in `try/catch`; on **any** throw (including the
    "none ignored" non-zero exit) return an empty set — i.e. keep every path (prior behaviour).
  - `committableExcludePaths(run: Runner, cwd: string, excludePaths?: readonly string[]): readonly string[]` —
    if `excludePaths` is empty/undefined return `[]`; otherwise compute `gitignoredSubset` and
    return `excludePaths.filter(p => !ignored.has(p))`.
- Change `commitChanges` to build the suffix from the filtered list, keeping status + add consistent:
  ```ts
  function commitChanges(run: Runner, message: string, cwd: string, opts?: { excludePaths?: readonly string[] }): boolean {
    const suffix = pathspecSuffix(committableExcludePaths(run, cwd, opts?.excludePaths));
    const status = run(`git status --porcelain${suffix}`, cwd);
    if (!status.trim()) return false;
    run(`git add -A${suffix}`, cwd);
    run(`git commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
    return true;
  }
  ```
- Leave `pathspecSuffix` unchanged (still returns `''` for an empty list, so no-`excludePaths`
  callers get byte-identical `git status --porcelain` / `git add -A` and never invoke
  `git check-ignore`). Keep helpers pure and use guard clauses (adhere to coding guidelines:
  immutability, ≤2 nesting, isolate side effects at the runner boundary).

### 2. Add the `commitOps` unit test (fake `run`)

- Create `adws/gitContext/__tests__/commitOps.test.ts` (vitest, mirroring the spy style in
  `gitContextOperations.test.ts`). Build a fake `run` that records every command and returns
  canned output keyed by command prefix:
  - `git status --porcelain` → return a non-empty string (e.g. `' M .adw/project.md\n'`) so the
    commit proceeds.
  - `git check-ignore` → **configurable per test** (return the ignored subset, or throw).
  - `git add` / `git commit` → record and return `''`.
- Assert the following cases against the recorded `git add` command:
  1. **Excluded path is gitignored** (`git check-ignore` returns `.claude/commands/adw_init.md`):
     the emitted `git add` command **omits** the `:(exclude)` token (it is `git add -A` with no
     ` -- '.' ...` suffix). Assert the recorded `git status` is likewise unsuffixed.
  2. **None ignored** (`git check-ignore` throws, simulating exit 1): the emitted `git add`
     **retains** `':(exclude).claude/commands/adw_init.md'`.
  3. **Mixed** (`excludePaths: ['a','b']`, `git check-ignore` returns only `'a'`): the emitted
     `git add` retains `':(exclude)b'` and omits `':(exclude)a'`.
  4. **No `excludePaths`**: `git check-ignore` is **never** invoked and `git add` is exactly
     `git add -A` (byte-identical baseline preserved).
- Confirm `commitChanges` still returns `false` (and issues no `git add`/`git commit`) when
  `git status --porcelain` is empty.

### 3. Confirm the `@adw-729` scenario file (already authored — per-issue, real code path)

The scenario file **already exists** at `features/per-issue/feature-729.feature`, tagged
`@adw-729 @adw-5o6zmy-bug-adwupgrade-regen` (per-issue placement per `.adw/scenarios.md`; **not**
`@regression` — promotion is human-gated, see Step 5). Do not move or re-tag it. It declares **two**
scenarios whose phrases the step definitions in Step 4 must implement verbatim:

- **§1 (RED→GREEN driver) — gitignored excluded path is recorded and carries the `.adw/` change:**
  - **Given** `an upgrade regen worktree whose command file ".claude/commands/adw_init.md" is gitignored by the real copy-init-command step`
  - **And** `the worktree has a pending regen change to ".adw/project.md"`
  - **When** `the framework upgrade commits the regen excluding ".claude/commands/adw_init.md"`
  - **Then** `the regen commit is recorded on the worktree branch`
  - **And** `the recorded commit's tree includes ".adw/project.md"`
  - **And** `the recorded commit's tree excludes ".claude/commands/adw_init.md"`
- **§2 (guard) — tracked, non-ignored excluded path is still held out:** identical When/Then, with
  Given `an upgrade regen worktree with a tracked, modified ".claude/commands/adw_init.md" that is not gitignored`.
  Green **before and after** the fix; it fails only if the ignore-safe filter wrongly drops a
  non-ignored exclude (over-correction guard, re-pinning #685 §D1).
- The three `Then` assertions read the **produced commit's tree** via
  `git show --name-only --format= HEAD` — a git artefact (Surface #3), never file-on-disk existence.

### 4. Add the step definitions (per-issue, `feature-685.steps.ts` §D pattern)

- Create `features/per-issue/step_definitions/feature-729.steps.ts`, mirroring
  `features/per-issue/step_definitions/feature-685.steps.ts` §D: bare `execSync('git …')`, an
  `initGitRepo` helper (`git init`; `git config user.email/user.name`), **module-scoped `let`
  state**, and `git show --name-only --format= HEAD` reads. Do **not** use the `@regression`
  `Before` hook / `setupMockInfrastructure()` / `REAL_GIT_PATH` — those belong to the regression
  suite, which this per-issue scenario is not part of.
  - Import the **real** `copyAdwInitCommandToWorktree` from `../../../adws/phases/worktreeSetup.ts`
    and the **real** `commitOps` from `../../../adws/gitContext/commitOps.ts` (or `GitContext` from
    `../../../adws/gitContext/index.ts` / `gitContext.ts`).
  - §1 `Given` (gitignored): `mkdtempSync` a temp dir; `initGitRepo`; seed a tracked `.gitignore`
    and a tracked `.adw/project.md`, `git add -A` + commit a baseline; then call
    `copyAdwInitCommandToWorktree(worktree, process.cwd())` — `process.cwd()` is the ADW repo root,
    which holds the real `.claude/commands/adw_init.md`. That copies the command file in **untracked
    and gitignored** (the production double-exclusion). Store the worktree path in module state.
  - §2 `Given` (tracked): same repo bootstrap, but create, **commit**, then modify
    `.claude/commands/adw_init.md` as a **tracked** file and write **no** `.gitignore` entry for it.
  - `And` (regen) step (`the worktree has a pending regen change to {string}`): overwrite the tracked
    `.adw/project.md` with new content (the real regen change).
  - `When` step (`the framework upgrade commits the regen excluding {string}`): drive the **real**
    commit path — `commitOps.commitChanges(realRun, message, worktree, { excludePaths: [<path>] })`
    with `realRun = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe','pipe','pipe'] })`
    (equivalently construct `new GitContext(opts)` with the default real exec and call
    `commitChanges`). Wrap in `try/catch`; record the thrown error (if any) and the pre-call HEAD in
    module state.
  - `Then` steps: `the regen commit is recorded on the worktree branch` asserts **no** captured error
    **and** HEAD advanced past the baseline; `the recorded commit's tree includes/excludes {string}`
    asserts membership in `git show --name-only --format= HEAD`. Guard so a §1 RED throw yields a
    clear failure rather than an assertion against a stale HEAD.
  - Add an `After({ tags: '@adw-729' })` hook to `rmSync` the temp worktree and clear module state.
- Reuse the already-registered `Given the ADW codebase is checked out` Background step (G18) — do not
  re-declare it.

### 5. Surface the `@regression` promotion + vocabulary phrases to the maintainer (do NOT auto-apply)

- **No edit to `features/regression/step_definitions/world.ts`.** State is module-scoped in the
  steps file (Step 4), matching the per-issue `feature-685.steps.ts` pattern — the regression
  `RegressionWorld` is not used to carry this scenario's state.
- **Do NOT auto-promote to `@regression` and do NOT edit `features/regression/vocabulary.md`.**
  `.adw/scenarios.md` declares the full regression-suite contract (all three of
  `Per-Issue Scenario Directory`, `Regression Scenario Directory`, `Vocabulary Registry`), under
  which the agent authors per-issue scenarios and leaves `@regression` promotion + vocabulary
  registration to the maintainer.
  <!-- ADW-WARNING: Issue Tests §2 + Acceptance require a "@regression scenario ... vocabulary phrases registered". Repo policy (.adw/scenarios.md) forbids the agent from auto-promoting @regression or auto-registering vocabulary — human decision only. Unresolvable automatically. The behavioural requirement (RED→GREEN commit-tree scenario) IS satisfied under @adw-729 in features/per-issue/feature-729.feature; the @regression tag + vocabulary registration must be applied by the maintainer. Do NOT force-tag the scenario or edit vocabulary.md to satisfy the literal Acceptance wording. -->
- In the build Output, **surface for the maintainer**: (a) a request to promote
  `features/per-issue/feature-729.feature` to `@regression` if desired, and (b) the novel phrases to
  register in `features/regression/vocabulary.md` at that time — each asserting the **produced
  commit's tree** (Surface #3), never file-on-disk existence:
  - `an upgrade regen worktree whose command file ".claude/commands/adw_init.md" is gitignored by the real copy-init-command step`
  - `an upgrade regen worktree with a tracked, modified ".claude/commands/adw_init.md" that is not gitignored`
  - `the worktree has a pending regen change to {string}`
  - `the framework upgrade commits the regen excluding {string}`
  - `the regen commit is recorded on the worktree branch`
  - `the recorded commit's tree includes {string}`
  - `the recorded commit's tree excludes {string}`

### 6. Validate the fix with zero regressions

- Run the RED-check first (optional, to confirm the guard bites): temporarily reverting the
  `commitOps.ts` change makes the `@adw-729` **§1** scenario fail at the `When`/first `Then` (the
  `git add` throws, no commit recorded), while **§2** stays green (the tracked path never crashed).
  With the fix applied both pass. Then run the full `Validation Commands` below and confirm all pass.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions. Commands come from
`.adw/commands.md`.

- **Reproduce the mechanism (before fix — demonstrates the crash):** run the `Steps to Reproduce`
  snippet above; command (2) `git add -A -- '.' ':(exclude).claude/commands/adw_init.md'` exits 1
  with "paths are ignored". This is what the fix removes from the `commitChanges` path.
- `bunx vitest run adws/gitContext/__tests__/commitOps.test.ts` — the new unit test passes (ignored
  → token omitted; none-ignored → token retained; mixed → only ignored dropped; no-opts baseline).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-729"` — the per-issue scenario passes
  GREEN: §1 (commit recorded; tree includes the `.adw/` change; tree excludes the gitignored
  `adw_init` command) — RED before the fix — and §2 (tracked, non-ignored exclude still held out) —
  green throughout.
- `bun run lint` — ESLint clean.
- `bun run lint:git-guard` — git-guard clean (new raw `git check-ignore` lives inside the exempt
  `adws/gitContext` package).
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes.
- `bun run build` — `tsc` build succeeds.
- `bun run test:unit` — full vitest suite passes (zero regressions, including `adwUpgrade.test.ts`).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the existing regression suite
  still passes (no regression). Note `feature-729.feature` is **per-issue, not `@regression`**, so it
  is **not** included in this run — it is validated by the `@adw-729` run above (promotion to
  `@regression` is a human decision per `.adw/scenarios.md`).

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`): keep the new helpers pure with guard clauses
  and ≤2 nesting; treat data as immutable (return new arrays/sets, do not mutate `excludePaths`);
  isolate the side effect (`git check-ignore`) at the injected-`run` boundary; document the
  non-obvious "check-ignore exits non-zero when none ignored → throw → keep all" behaviour in a
  JSDoc comment. `commitOps.ts` stays well under the 300-line ceiling.
- **No new library** is required (`git check-ignore` is a plain git subcommand run through the
  existing injected runner). If any dependency were ever needed, the install command per
  `.adw/commands.md` is `bun add <package>`.
- **Scope discipline:** the change is confined to `commitOps.ts` plus tests/scenario/vocabulary.
  `adwUpgrade.tsx` and `worktreeSetup.ts` are intentionally left untouched — the crash is a
  `commitOps` concern and fixing it there also protects any future `excludePaths` caller.
- **Preserved invariants** (per `app_docs/feature-t6m62c-...`): status and add always share the
  same pathspec; callers with no `excludePaths` are byte-identical (no `git check-ignore` call).
  The document phase should update that owning doc to record the ignore-safe filter.
- **Scenario routing / promotion (per `.adw/scenarios.md`):** this repo has the full
  regression-suite contract enabled (`Per-Issue Scenario Directory`, `Regression Scenario
  Directory`, `Vocabulary Registry` all set), so the behavioural scenario is authored under
  `features/per-issue/feature-729.feature` (tagged `@adw-729`, **not** `@regression`) with
  module-scoped step state, and the `@regression` promotion + `features/regression/vocabulary.md`
  registration that the issue's Tests §2 / Acceptance mention are **surfaced to the maintainer**,
  not auto-applied by the agent. The behavioural guarantee the issue requires (the RED→GREEN
  commit-tree scenario) is fully delivered under `@adw-729`; only the promotion/registration is
  human-gated. This is the single point where the issue's literal wording and the repo's configured
  workflow diverge — see the `ADW-WARNING` in Relevant Files / Step 5.
- **Known non-goal / edge:** a path that is simultaneously *tracked* **and** gitignored would be
  dropped from the exclude by this filter (and `git add -A` would then re-stage its modifications).
  That combination does not arise for `.claude/commands/adw_init.md` (self-host: tracked + not
  ignored → kept; target: untracked + ignored → dropped), and widening the filter to consult the
  index is out of scope for this bug. Following the issue exactly keeps the fix minimal.
- **Operational follow-up (out of scope):** recovering the stranded `72nhdz` / re-driving crashed
  upgrades is tracked as feature #730 (Blocked by #729). Do not attempt redrive here; re-spawning a
  crashed `adwUpgrade` before this fix merges would re-hit the same crash.
