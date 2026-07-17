# Feature: Write a starter guardrail `settings.json` into target repos that lack one

## Metadata
issueNumber: `763`
adwId: `i46l4f-adw-init-write-start`
issueJson: `{"number":763,"title":"adw_init: write starter guardrail settings.json to target repos that lack one","body":"## Blocked by\n\n#762\n\n## Problem\n\nRepo owners without Claude Code guardrail experience get none at all...","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-07-17T10:00:05Z"}`

## Feature Description
Issue #762 shipped ADW's *enforced* guardrails: on every target-repo agent spawn, `claudeAgent`
injects a `--settings` payload (deny list + hooks) so ADW's own runs are protected regardless of
the target repo's configuration. That injection is framework-internal and invisible to the repo
owner — it protects **ADW runs only**.

This feature closes the complementary gap: the **repo owner's own interactive Claude Code
sessions** still run with zero deny rules. During `/adw_init` (which is driven exclusively by the
`adwUpgrade.tsx` orchestrator, and therefore also runs automatically during every framework-upgrade
regeneration), if the target repo has **no** `.claude/settings.json`, ADW copies the canonical
`templates/claude-settings-starter.json` (the deny-only list created by #762) verbatim to
`.claude/settings.json` and commits it as part of the init/upgrade PR. The file is the owner's to
keep, edit, or delete — so unlike the copied commands/skills it is **committed and not gitignored**,
and it is **never** written if the owner already has a `.claude/settings.json`.

The starter carries **deny permissions only, no hooks**: ADW's plumbing hooks stay framework-internal
via the #762 `--settings` injection, and a committed hook script would wrongly impose a `bun`/`node`
runtime on non-JS repos.

## User Story
As a repo owner onboarding my repository to ADW who has no Claude Code guardrail experience
I want ADW to drop a sensible starter `.claude/settings.json` deny list into my repo (only if I do not already have one)
So that my own interactive Claude Code sessions are protected from destructive commands (recursive-force `rm`, force-push, reading `.env` secrets) without me having to author a settings file from scratch — while my existing settings, if any, are never touched.

## Problem Statement
`copyClaudeAssetsToWorktree` (`adws/phases/worktreeSetup.ts:199`) copies only `.claude/commands/`
and `.claude/skills/` into target worktrees, and gitignores the framework-internal ones. Nothing
ever writes a `.claude/settings.json` into a target repo. A repo owner who has never configured
Claude Code therefore has **no deny rules for their own sessions** — the exact destructive-command
exposure (`rm -rf`, `git push --force`, `Read(**/.env*)`) that #762's canonical deny list was built
to close, but which #762 only wired into ADW's *own* spawns.

## Solution Statement
Add a **deterministic, idempotent** starter-settings copy to the single orchestrator that runs
`/adw_init` (`adwUpgrade.tsx`), plus a small pure decision function that the mandated unit test can
target:

1. **Pure decision (`decideStarterSettingsCopy`)** — given whether `.claude/settings.json` already
   exists in the worktree, return `copy` or `skip (already exists)`. This is the skip-if-exists
   decision the acceptance criteria require a unit test for.
2. **Copy helper (`copyStarterSettingsToWorktree`)** in `worktreeSetup.ts` — reads the decision from
   `fs.existsSync`, and on `copy` performs a **byte-identical** `fs.copyFileSync` of
   `templates/claude-settings-starter.json` → `<worktree>/.claude/settings.json`. It does **not**
   add the file to `.gitignore` (deliberately unlike the commands/skills copy) and logs the skip
   when the owner already has a settings file.
3. **Orchestrator wiring** — `executeUpgrade` calls the copy through a new injectable
   `copyStarterSettings` dep, positioned after the `verifyAdwRegen` gate and before `commitChanges`.
   Because the existing `commitChanges` runs `git add -A` excluding only `adw_init.md`, a
   non-gitignored `.claude/settings.json` is committed into the init/upgrade PR automatically — no
   commit-path change is needed.
4. **Docs note + rollout trigger** — add a short instruction to `.claude/commands/adw_init.md`
   telling the init LLM to emit an `## Agent Guardrails` section into the generated `.adw/project.md`
   documenting that the `Read(!...)` negation carve-outs rely on undocumented CLI behavior, are
   verified by `scripts/guardrails-probe.ts` (#762), and should be re-probed after Claude Code CLI
   upgrades. Editing `adw_init.md` (a `hashInputs:` file) also **bumps `.adw-version`**, which is the
   mechanism that fans an upgrade out to every registered target repo — the same wave that delivers
   the starter `settings.json`.

Self-host (the framework repo itself) needs no special-casing: it already ships its own authoritative
`.claude/settings.json`, so `decideStarterSettingsCopy` naturally returns `skip`.

## Relevant Files
Use these files to implement the feature:

- `adws/adwUpgrade.tsx` — **the sole orchestrator that runs `/adw_init`** (confirmed: the only
  `runClaudeAgentWithCommand('/adw_init', ...)` call site; there is no `adwInit.tsx`). `executeUpgrade`
  already threads `frameworkRepoRoot`, injects side effects via `UpgradeDeps`, and calls
  `copyInitCommandToWorktree` → `runInitCommand` → `verifyAdwRegen` → `commitChanges` (with
  `excludePaths: ['.claude/commands/adw_init.md']`). New `copyStarterSettings` dep + call site goes
  here, between the `verifyAdwRegen` gate (`:350`) and `commitChanges` (`:367`).
- `adws/phases/worktreeSetup.ts` — home of the worktree-materialization helpers
  (`copyAdwInitCommandToWorktree`, `verifyAdwRegen`, `ensureGitignoreEntry`,
  `copyClaudeAssetsToWorktree`). New `decideStarterSettingsCopy` (pure) and
  `copyStarterSettingsToWorktree` (fs) belong beside them. Note the gitignore policy the starter must
  **not** follow: commands/skills get `ensureGitignoreEntries`; the starter must not.
- `adws/core/guardrailsPayload.ts` — owns the canonical template path as the module-private
  `TEMPLATE_RELATIVE_PATH = path.join('templates','claude-settings-starter.json')` (`:15`). Export a
  shared constant (e.g. `STARTER_SETTINGS_TEMPLATE_RELATIVE_PATH`) here and consume it from
  `worktreeSetup.ts`, so the template location stays a single source of truth (the #762 SSOT intent).
- `templates/claude-settings-starter.json` — the verbatim copy source (13 deny patterns, no allow,
  no hooks). **Read-only reference — do not modify.** This is what gets byte-copied.
- `.claude/commands/adw_init.md` — the LLM init command. Add the `## Agent Guardrails` docs-note
  instruction (emitted into `.adw/project.md`). Its `hashInputs:` frontmatter means this edit bumps
  the framework hash and triggers the upgrade wave that rolls the copy out to existing repos.
- `adws/phases/__tests__/worktreeSetup.test.ts` — existing vitest fixture suite (temp git repo per
  test; `initGitRepo` helper; `gitignoreContains` helper). Add unit tests for the pure decision and
  the copy helper here.
- `adws/__tests__/adwUpgrade.test.ts` — existing `executeUpgrade` unit suite with the `makeDeps`
  injectable-deps factory (`:23`). Add the `copyStarterSettings` mock to `makeDeps` and assert the
  call site (invoked on the happy path, before `commitChanges`).
- `adws/gitContext/commitOps.ts` — reference only; confirms `commitChanges` stages via
  `git add -A -- '.' ':(exclude)...'`, so a non-gitignored, non-excluded `.claude/settings.json` is
  committed with no change to this file.

### New Files
- `features/per-issue/feature-763.feature` — `@adw-763`-tagged BDD scenarios (fresh-repo copy,
  existing-file skip, upgrade-regen idempotency). Routed to `features/per-issue/` per `.adw/scenarios.md`.
- `features/per-issue/step_definitions/feature-763.steps.ts` — self-contained `@adw-763` step
  definitions driving the real `copyStarterSettingsToWorktree` / `decideStarterSettingsCopy` against a
  temp git worktree (no LLM needed — the copy is deterministic).

### Conditional Documentation (matched conditions in `.adw/conditional_docs.md`)
- `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` — **Owns** `adws/adwUpgrade.tsx`,
  `adws/phases/worktreeSetup.ts`, `adws/gitContext/commitOps.ts`. Matched conditions: "When working on
  `adwUpgrade.tsx` `executeUpgrade()`, `UpgradeDeps`…"; "When modifying `copyClaudeAssetsToWorktree` or
  the `target:` flag gitignore policy in `worktreeSetup.ts`"; "When troubleshooting skill/command
  propagation to worktrees or target repos"; "When `commitChanges` `excludePaths`… is relevant".
- `app_docs/feature-0rvmyc-target-repo-guardrails-injection.md` — **Owns**
  `templates/claude-settings-starter.json`, `adws/core/guardrailsPayload.ts`, `scripts/guardrails-probe.ts`.
  Matched: "the deny-list template… the single source of truth also copied verbatim into target repos
  by `/adw_init` (follow-up issue)"; the probe script the docs note references.
- `app_docs/feature-n9880l-adwversion-read-write-module.md` — context for how the `adw_init.md`
  hashInput bump propagates through `.adw-version` and `adwUpgrade` to registered target repos.

## Implementation Plan
### Phase 1: Foundation
Establish the single-source-of-truth template path and the pure, independently-testable decision.
- Export the template relative-path constant from `guardrailsPayload.ts` so the new copy helper and
  the existing payload builder resolve the template through the same constant (no drift).
- Add the pure `decideStarterSettingsCopy` function — no I/O, trivially unit-testable, satisfies the
  "unit test for the skip-if-exists decision" acceptance criterion.

### Phase 2: Core Implementation
Add the fs copy helper and wire it into the orchestrator.
- `copyStarterSettingsToWorktree(worktreePath, frameworkRepoRoot)` in `worktreeSetup.ts`: `mkdir -p`
  the worktree `.claude/` dir, consult `decideStarterSettingsCopy` via `fs.existsSync`, and on `copy`
  `fs.copyFileSync` the template (byte-identical); on `skip` log the skip. Never touch `.gitignore`.
  Return a small result object (`{ action: 'copied' | 'skipped'; destPath }`) for logging/assertions.
- Add `copyStarterSettings` to `UpgradeDeps`, default it to `copyStarterSettingsToWorktree` in
  `buildDefaultUpgradeDeps`, and call it in `executeUpgrade` after the `verifyAdwRegen` pass and before
  `commitChanges`. The existing commit (which excludes only `adw_init.md`) then carries the new file.

### Phase 3: Integration
Roll it out and document it.
- Add the `## Agent Guardrails` docs-note instruction to `.claude/commands/adw_init.md` (emitted into
  the generated `.adw/project.md`). This edit both satisfies the docs requirement **and** bumps the
  framework hash, which is what triggers `adwUpgrade` to regenerate `.adw/` across every registered
  target repo — the wave that also copies the starter `settings.json`.
- Author the `@adw-763` BDD scenarios and step definitions proving the three end-to-end behaviors.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Export a shared template-path constant (`adws/core/guardrailsPayload.ts`)
- Promote the module-private `TEMPLATE_RELATIVE_PATH` (`:15`) to an exported constant named
  `STARTER_SETTINGS_TEMPLATE_RELATIVE_PATH` (keep an internal alias if it minimizes churn), with a
  JSDoc noting it is the SSOT template location consumed by both the spawn-time payload builder and the
  `/adw_init` target-repo copy.
- Do not change any behavior of `buildGuardrailsSettings` / `readDenyList`.

### 2. Add the pure skip-if-exists decision (`adws/phases/worktreeSetup.ts`)
- Add `export type StarterSettingsDecision = { action: 'copy' } | { action: 'skip'; reason: 'already_exists' }`.
- Add `export function decideStarterSettingsCopy({ settingsExists }: { settingsExists: boolean }): StarterSettingsDecision`
  returning `{ action: 'skip', reason: 'already_exists' }` when `settingsExists`, else `{ action: 'copy' }`.
- Guard-clause style, immutable locals, JSDoc — matches the file's conventions.

### 3. Add the copy helper (`adws/phases/worktreeSetup.ts`)
- Add `export interface StarterSettingsResult { action: 'copied' | 'skipped'; destPath: string }`.
- Add `export function copyStarterSettingsToWorktree(worktreePath: string, frameworkRepoRoot: string): StarterSettingsResult`:
  - Compute `destPath = path.join(worktreePath, '.claude', 'settings.json')`.
  - `const decision = decideStarterSettingsCopy({ settingsExists: fs.existsSync(destPath) })`.
  - On `skip`: `log('Target repo already has .claude/settings.json; skipping starter guardrails copy', 'info')`
    and return `{ action: 'skipped', destPath }`. **Do not read or modify the existing file.**
  - On `copy`: `fs.mkdirSync(path.dirname(destPath), { recursive: true })`, then
    `fs.copyFileSync(path.join(frameworkRepoRoot, STARTER_SETTINGS_TEMPLATE_RELATIVE_PATH), destPath)`
    (byte-identical), log the copy, return `{ action: 'copied', destPath }`.
  - **Never** call `ensureGitignoreEntry(...)` for this path — the starter must remain committable.
- Import `STARTER_SETTINGS_TEMPLATE_RELATIVE_PATH` from `../core` (add it to the barrel export if that
  is how `guardrailsPayload` exports flow through `adws/core/index`).

### 4. Unit-test the pure decision and the copy helper (`adws/phases/__tests__/worktreeSetup.test.ts`)
- `decideStarterSettingsCopy`: returns `copy` when `settingsExists=false`; returns `skip/already_exists`
  when `settingsExists=true`.
- `copyStarterSettingsToWorktree` against a temp git repo (reuse `initGitRepo`, temp-dir fixtures):
  - **Fresh repo (no `.claude/settings.json`)** → after call: file exists; its bytes equal
    `templates/claude-settings-starter.json` exactly (read both, assert `Buffer.equal` / string
    equality); `gitignoreContains(worktree, '.claude/settings.json') === false`; `git add -A` +
    `git status --porcelain` shows it staged/committable (mirrors the E4 "git-committable" assertions).
  - **Existing file** → seed `.claude/settings.json` with distinctive owner content, call the helper,
    assert the file bytes are unchanged (untouched) and the result is `skipped`.

### 5. Wire the copy into the orchestrator (`adws/adwUpgrade.tsx`)
- Add to `UpgradeDeps`: `readonly copyStarterSettings: (worktreePath: string, frameworkRepoRoot: string) => StarterSettingsResult;`
  (import the type from `worktreeSetup`).
- In `buildDefaultUpgradeDeps`, set `copyStarterSettings: copyStarterSettingsToWorktree` (add to the
  existing `import { copyAdwInitCommandToWorktree, verifyAdwRegen } from './phases/worktreeSetup'`).
- In `executeUpgrade`, immediately after the `verifyAdwRegen` success path (`:362`) and before
  `deps.writeAdwVersion` / `deps.commitChanges` (`:365`), call:
  `const starter = deps.copyStarterSettings(worktreePath, frameworkRepoRoot);` and
  `deps.log('adwUpgrade: starter guardrails settings ' + starter.action + ' (' + starter.destPath + ')', 'info');`.
  Placement rationale: after regen validity is confirmed, so it rides the same regen commit; before the
  commit, so `git add -A` picks it up. It is deliberately **not** added to `commitChanges` `excludePaths`.

### 6. Unit-test the orchestrator wiring (`adws/__tests__/adwUpgrade.test.ts`)
- Add `copyStarterSettings: vi.fn().mockReturnValue({ action: 'copied', destPath: '/worktrees/.../.claude/settings.json' })`
  to the `makeDeps` default factory (`:23`).
- New tests on `executeUpgrade`:
  - Happy path calls `copyStarterSettings` exactly once with `(worktreePath, frameworkRepoRoot)`.
  - `copyStarterSettings` is invoked **before** `commitChanges` (assert call order via
    `vi.fn` invocation-order, e.g. compare `mock.invocationCallOrder`), and `commitChanges` is still
    called with `excludePaths: ['.claude/commands/adw_init.md']` (starter not excluded).
  - A `{ action: 'skipped' }` return still proceeds to commit/push/PR (idempotency does not abort the run).

### 7. Add the docs-note instruction + hash bump (`.claude/commands/adw_init.md`)
- Insert a new numbered instruction (e.g. between current steps 6 and 7, renumbering the trailing
  Report step) directing the init LLM to write a concise `## Agent Guardrails` section into the
  generated `.adw/project.md`. Specify fixed, faithful note text, e.g.:

  > `## Agent Guardrails`
  > `If this repo had no .claude/settings.json, ADW copied a starter deny-only guardrail file into it`
  > `during initialization (yours to edit or delete). Its Read(!**/.env.sample) / Read(!**/.env.example)`
  > `negation carve-outs rely on UNDOCUMENTED Claude Code CLI precedence behavior; the framework verifies`
  > `it with scripts/guardrails-probe.ts (issue #762), which should be re-run after each Claude Code CLI`
  > `upgrade to confirm the carve-outs still hold.`

- Because `adw_init.md` is listed in its own `hashInputs:` frontmatter, this edit raises `.adw-version`
  and triggers `adwUpgrade` regeneration across registered target repos — the intended propagation that
  also delivers the starter `settings.json` copy from step 5. Note this coupling in the step-8 Report
  bullets of `adw_init.md` (mirroring the existing "hashInputs propagation" note).

### 8. Author the `@adw-763` BDD scenarios (`features/per-issue/feature-763.feature` + step defs)
- Scenarios (harness-observable via git artifacts / file bytes — no LLM needed):
  1. **Fresh target repo without settings** → run the starter copy in a temp worktree → `.claude/settings.json`
     exists, is byte-identical to the template, is git-committable (staged, not gitignored).
  2. **Target repo with an existing `.claude/settings.json`** → owner file untouched (byte-preserved),
     copy result/log records the skip.
  3. **Re-run (upgrade regen) on a repo that already received the starter** → second copy is a no-op;
     `git status` shows no change and no duplicate entry.
- Add self-contained `@adw-763` step definitions under `features/per-issue/step_definitions/`, driving
  the **real** `copyStarterSettingsToWorktree` / `decideStarterSettingsCopy` against a temp git repo
  (follow the `worktreeSetup.test.ts` fixture pattern). Validate step phrases against
  `features/regression/vocabulary.md` per `.adw/scenarios.md`.

### 9. Run the Validation Commands
- Execute every command in the Validation Commands section and confirm zero regressions.

## Testing Strategy
### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope (vitest).
- `adws/phases/__tests__/worktreeSetup.test.ts`:
  - `decideStarterSettingsCopy` — copy-when-absent and skip-when-present (the mandated skip-if-exists test).
  - `copyStarterSettingsToWorktree` — byte-identical copy into a fresh worktree, not gitignored,
    git-committable; existing-file untouched + skipped.
- `adws/__tests__/adwUpgrade.test.ts`:
  - `copyStarterSettings` added to `makeDeps`; happy-path invocation with correct args; invoked before
    `commitChanges`; `commitChanges` still excludes only `adw_init.md`; skip return still commits.
- `adws/core/__tests__/guardrailsPayload.test.ts` — sanity that the exported
  `STARTER_SETTINGS_TEMPLATE_RELATIVE_PATH` still resolves the real template and `buildGuardrailsSettings`
  is unchanged (extend existing suite only if the export rename touches it).

### Edge Cases
- **Self-host run** — framework repo already has `.claude/settings.json` → `skip`; no double-write, no
  clobber of the authoritative (hooks-bearing) settings file.
- **Existing owner settings.json** — never read, merged, or overwritten; skip is logged.
- **Idempotent re-regen** — once the starter is committed to the default branch, later upgrade worktrees
  check it out and skip; no duplicate, no diff.
- **Missing `.claude/` directory** — `copyStarterSettingsToWorktree` `mkdir -p`s `.claude/` before copy
  (a brand-new repo may have none yet, though step-4 `copyInitCommandToWorktree` usually creates it).
- **Owner-gitignored `.claude/settings.json`** — if a target repo's own `.gitignore` already excludes
  this path, `git add -A` won't stage the copy (it won't be committed). This is the owner's pre-existing
  choice; document it as a known limitation rather than force-adding.
- **Byte-identical guarantee** — copy via `fs.copyFileSync` (not JSON re-serialize) so no whitespace/key
  reordering can diverge from the template.

## Acceptance Criteria
- Fresh target repo without settings: after init/upgrade regen, `.claude/settings.json` exists, is
  byte-identical to `templates/claude-settings-starter.json`, and is committed (staged by the regen
  commit, not gitignored).
- Target repo with an existing `.claude/settings.json`: the file is untouched (bytes unchanged) and the
  init run logs the skip.
- Re-running init (upgrade regen) on a repo that already received the starter: no change to
  `.claude/settings.json`, no duplicate file or commit.
- The starter contains deny permissions only (no hooks), inherited verbatim from the #762 template.
- A unit test exists for the skip-if-exists decision (`decideStarterSettingsCopy`).
- `.adw/project.md` generated by `/adw_init` contains the `## Agent Guardrails` note referencing the
  undocumented `Read(!...)` carve-out behavior and the #762 probe.
- `@adw-763` BDD scenarios pass; full unit suite, lint, typecheck, and build pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions
(from `.adw/commands.md`):

- `bun run lint` — lint the changed TypeScript.
- `bunx tsc --noEmit` — root type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type check (additional).
- `bun run test:unit` — full vitest unit suite (includes the new `worktreeSetup` and `adwUpgrade` tests).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-763"` — the new BDD scenarios pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression scenarios still pass.
- `bun run build` — build succeeds with no errors.

## Notes
- **No new libraries.** Everything uses `node:fs` / `node:path` already imported in the touched files.
  (Install command, if ever needed, per `.adw/commands.md`: `bun add <package>`.)
- **Single integration point.** There is no `adwInit.tsx`; `adwUpgrade.tsx` is the only orchestrator
  that runs `/adw_init`, covering both first-time onboarding (never-initialized repo) and
  framework-upgrade regeneration. Wiring the copy there satisfies both "during `/adw_init`" and
  "automatically during framework-upgrade regeneration".
- **Why the copy is deterministic (orchestrator), not an LLM step.** The acceptance criteria demand a
  unit-testable skip-if-exists decision and a byte-identical copy, and require gitignore/commit control
  the LLM command cannot exercise. Only the *docs note* (prose) is LLM-authored, in `adw_init.md`.
- **Rollout coupling.** A pure `worktreeSetup.ts`/`adwUpgrade.tsx` code change does **not** change the
  framework hash and would only affect new onboardings / unrelated future upgrades. The `adw_init.md`
  edit (docs note) is what bumps `.adw-version` and fans an upgrade wave out to all registered repos —
  so it is load-bearing for proactive rollout, not merely cosmetic.
- **Template stays SSOT.** Do not duplicate or edit `templates/claude-settings-starter.json`; the copy
  reads it through the shared `STARTER_SETTINGS_TEMPLATE_RELATIVE_PATH` constant that #762's payload
  builder also uses. The template's `Read(!**/.env.example)` line is the carve-out the docs note
  describes; keeping the copy verbatim keeps target-repo settings aligned with the #762 pre-tool-use
  `.env.example` carve-out.
- **Deliberately NOT added to `hashInputs:`** — `templates/claude-settings-starter.json` is not added to
  `adw_init.md`'s `hashInputs:` list. Skip-if-exists makes deny-list edits non-propagating to repos that
  already have a settings file, so hashing the template would only churn upgrades for no material change.
  (Open consideration, not a blocker — revisit if future deny-list edits must reach starter-only repos.)
- **Guidelines.** `.adw/coding_guidelines.md` / `guidelines/coding_guidelines.md` were not found in this
  repo; follow the existing conventions in `worktreeSetup.ts` and `adwUpgrade.tsx` (guard clauses,
  immutable locals, JSDoc on exports, injectable deps for orchestrator side effects, no decorators).
- **Open design choice (minor):** the docs note is placed in the init-generated `.adw/project.md`
  (`## Agent Guardrails`) as the closest fit among the generated docs. If a reviewer prefers a different
  generated doc or heading, adjust the `adw_init.md` instruction — the note text and its intent are the
  contract, not the exact heading.
