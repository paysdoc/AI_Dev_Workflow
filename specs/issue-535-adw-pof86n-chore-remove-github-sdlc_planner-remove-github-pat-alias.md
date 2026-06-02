# Feature: Remove the `GITHUB_PERSONAL_ACCESS_TOKEN` alias, keep `GITHUB_PAT` canonical

## Metadata
issueNumber: `535`
adwId: `pof86n-chore-remove-github`
issueJson: `{"number":535,"title":"chore: remove GITHUB_PERSONAL_ACCESS_TOKEN alias, keep GITHUB_PAT canonical","body":"## Context\n\n`adws/core/environment.ts:95` exports the GitHub PAT as:\n\n```ts\nexport const GITHUB_PAT = process.env.GITHUB_PAT || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;\n```\n\nThe `GITHUB_PERSONAL_ACCESS_TOKEN` fallback is a vestigial alias inherited from the original course. The env var name has nothing to do with the token format — a `github_pat_...` fine-grained token works equally well inside an env var called `GITHUB_PAT`. Having two names for the same secret invites confusion (operator sets one, code reads the other) and forces the SAFE_ENV_VARS allowlist + healthCheck + docs to mention both.\n\nConsolidate on `GITHUB_PAT` as the single canonical name.\n\n## Scope\n\nRemove every mention of `GITHUB_PERSONAL_ACCESS_TOKEN`:\n\n- `adws/core/environment.ts:95` — drop the `|| process.env.GITHUB_PERSONAL_ACCESS_TOKEN` fallback\n- `adws/core/environment.ts:161` — remove from `SAFE_ENV_VARS`\n- `adws/healthCheckChecks.ts:52` — remove from the optional-vars list\n- `app_docs/feature-hjcays-fix-board-pat-auth.md` — collapse the two-name references to just `GITHUB_PAT`\n- `specs/issue-446-adw-hjcays-ensurecolumns-fails-sdlc_planner-fix-board-pat-auth.md` — same\n\n## Non-goals\n\n- Renaming `GITHUB_PAT` to anything else\n- Changing how the PAT-swap fallback works in `projectBoardApi.ts`, `githubBoardManager.ts`, or `prApi.ts`\n- Changing the token format expectation (fine-grained `github_pat_...` and classic `ghp_...` both stay supported — but see caveat below)\n\n## Operator-visible breaking change\n\nAnyone whose `.env` only sets `GITHUB_PERSONAL_ACCESS_TOKEN` (no `GITHUB_PAT`) will silently lose PAT-swap behavior for Projects V2 and PR-approval-as-personal-identity after the merge. Call this out in the PR body and the changelog/`app_docs` entry.\n\n## Caveat for the implementer\n\nFine-grained PATs have historically been spotty against Projects V2 GraphQL on user-owned project boards. The `projectBoardApi.ts` PAT-swap was designed against classic `ghp_` tokens with the `project` scope. This issue does not change that behavior, but document the recommendation (classic PAT with `project` scope) in `.env.sample` and the README.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-02T15:55:22Z","comments":[],"actionableComment":null}`

## Feature Description
ADW currently resolves the GitHub personal access token from two interchangeable environment variable names:

```ts
export const GITHUB_PAT = process.env.GITHUB_PAT || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
```

The `GITHUB_PERSONAL_ACCESS_TOKEN` fallback is a vestigial alias inherited from the original Agentic Engineer course. The env var *name* has no relationship to the token *format* — a fine-grained `github_pat_...` token and a classic `ghp_...` token both work inside an env var called `GITHUB_PAT`. Carrying two names for the same secret is a standing source of confusion (operator sets one name, code reads the other) and forces the subprocess allowlist (`SAFE_ENV_VARS`), the health check, and the docs to enumerate both.

This feature consolidates on `GITHUB_PAT` as the single canonical name by removing every mention of `GITHUB_PERSONAL_ACCESS_TOKEN` from the codebase and documentation, and — per the issue caveat — adds an explicit recommendation (classic PAT with the `project` scope) to `.env.sample` and the README so operators configuring Projects V2 board automation pick a token that actually works against user-owned boards.

The value: one name for one secret, a smaller allowlist surface, simpler health-check output, and operator docs that no longer hint at a deprecated alias. The change is deliberately behavior-narrowing — it is a chore-shaped consolidation, not a feature addition.

## User Story
As an ADW operator configuring GitHub authentication for a target repository
I want a single, canonical `GITHUB_PAT` environment variable (with clear guidance on which token type to use)
So that I am never confused about which of two names the framework actually reads, and my Projects V2 board automation works on the first try.

## Problem Statement
The GitHub PAT is addressable by two environment variable names (`GITHUB_PAT` and the legacy alias `GITHUB_PERSONAL_ACCESS_TOKEN`). This duplication:

1. **Invites silent misconfiguration** — an operator who sets only one name may read docs or code that reference the other.
2. **Bloats the trust surface** — `SAFE_ENV_VARS` (the allowlist of variables forwarded to Claude CLI subprocesses) and the health-check optional-vars list both have to carry the alias.
3. **Leaves stale two-name references in docs** — `app_docs/feature-hjcays-fix-board-pat-auth.md` and `specs/issue-446-…-fix-board-pat-auth.md` both spell out `GITHUB_PAT / GITHUB_PERSONAL_ACCESS_TOKEN`.
4. **Lacks token-type guidance** — neither `.env.sample` nor the README tells operators that fine-grained PATs are unreliable against Projects V2 GraphQL on user-owned boards, so board automation can fail in a way that looks like a code bug.

## Solution Statement
Remove the alias everywhere and consolidate on `GITHUB_PAT`:

1. Drop the `|| process.env.GITHUB_PERSONAL_ACCESS_TOKEN` fallback in `adws/core/environment.ts` so `GITHUB_PAT` resolves solely from `process.env.GITHUB_PAT`.
2. Remove the `'GITHUB_PERSONAL_ACCESS_TOKEN'` entry from the `SAFE_ENV_VARS` allowlist in the same file, so the legacy name is no longer forwarded to subprocesses.
3. Remove `'GITHUB_PERSONAL_ACCESS_TOKEN'` from the optional-vars list in `adws/healthCheckChecks.ts`.
4. Collapse the two-name references in `app_docs/feature-hjcays-fix-board-pat-auth.md` and `specs/issue-446-adw-hjcays-ensurecolumns-fails-sdlc_planner-fix-board-pat-auth.md` to just `GITHUB_PAT`.
5. Add the classic-PAT-with-`project`-scope recommendation to `.env.sample` and the README, and use the README's `GITHUB_PAT` entry to record the operator-visible breaking change (the legacy alias is no longer read).

The change is type-safe: both sides of the removed `||` were `string | undefined`, so `GITHUB_PAT` keeps its `string | undefined` type and no downstream consumer breaks. No new libraries are required.

## Relevant Files
Use these files to implement the feature:

- `adws/core/environment.ts` — **primary edit.** Line 95 defines `GITHUB_PAT` with the alias fallback; line 161 lists `'GITHUB_PERSONAL_ACCESS_TOKEN'` inside the `SAFE_ENV_VARS` allowlist. Both must go. `GITHUB_PAT` becomes `process.env.GITHUB_PAT`; the allowlist drops the alias line. `getSafeSubprocessEnv()` (lines 189-198) iterates `SAFE_ENV_VARS` and is the function whose behavior the unit tests pin.
- `adws/healthCheckChecks.ts` — **edit.** Line 52: `const optional = ['CLAUDE_CODE_PATH', 'GITHUB_PAT', 'GITHUB_PERSONAL_ACCESS_TOKEN'];` → drop the alias. `checkEnvironmentVariables()` reports which optional vars are present; removing the alias means the health check no longer recognizes it.
- `app_docs/feature-hjcays-fix-board-pat-auth.md` — **edit.** Line 46 (`Ensure \`GITHUB_PAT\` (or \`GITHUB_PERSONAL_ACCESS_TOKEN\`) is set …`) and line 54 (config table row `\`GITHUB_PAT\` / \`GITHUB_PERSONAL_ACCESS_TOKEN\``) collapse to `GITHUB_PAT` only. Line 54 already documents "Personal access token with `project` scope" — preserve and lightly clarify that a classic PAT is recommended.
- `specs/issue-446-adw-hjcays-ensurecolumns-fails-sdlc_planner-fix-board-pat-auth.md` — **edit.** Line 47 quotes the old two-name definition (`export const GITHUB_PAT = process.env.GITHUB_PAT || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;` with a stale `(line 70)`). Collapse the snippet to `export const GITHUB_PAT = process.env.GITHUB_PAT;` and drop the stale line reference; this is a historical record, so keep the surrounding "No changes needed" prose.
- `.env.sample` — **edit.** Lines 8-9 carry the commented `GITHUB_PAT` example (`ghp_...`). Add a comment recommending a classic PAT with the `project` scope and noting that fine-grained `github_pat_...` tokens are unreliable against Projects V2 GraphQL on user-owned boards.
- `README.md` — **edit.** Line 195 is the `GITHUB_PAT` bullet in the env-var reference. Extend it with the classic-PAT-with-`project`-scope recommendation and the migration note that `GITHUB_PERSONAL_ACCESS_TOKEN` is no longer read (operator-visible breaking change).
- `adws/github/projectBoardApi.ts` — **reference only, do not modify.** Lines 236-242 hold the canonical PAT-swap (`isGitHubAppConfigured() && GITHUB_PAT && GITHUB_PAT !== process.env.GH_TOKEN`). It imports `GITHUB_PAT` from `core/config` (which re-exports it from `environment.ts`). Confirms the behavioral contract that must stay intact after the alias removal.
- `adws/core/config.ts` — **reference only.** Re-exports `GITHUB_PAT` from `environment.ts`; confirm no second alias resolution exists here.
- `.adw/coding_guidelines.md` — coding guidelines (keep files < 300 lines, prefer pure functions, isolate side effects, remove unused code). The edits are deletions and small additions and stay well within these rules.

### Context Docs (read for the PAT-swap / `GITHUB_PAT` contract; do not edit unless listed above)
- `app_docs/feature-9tknkw-project-board-pat-fallback.md` — canonical description of the upfront-PAT-swap pattern in `moveIssueToStatus`; confirms `GITHUB_PAT` is the single var the swap reads.
- `app_docs/feature-2umujr-fix-pr-auth-token-override.md` — `GH_TOKEN` vs `GITHUB_PAT` interaction in subprocess environments (PR-approval-as-personal-identity path mentioned in the breaking-change note).
- `app_docs/feature-fygx90-hitl-label-gate-automerge.md` — documents `GITHUB_PAT` as the Projects V2 GraphQL fallback on user-owned repos.

### New Files
- `adws/core/__tests__/environment.test.ts` — new Vitest unit test pinning the subprocess-allowlist behavior after the alias removal (see Testing Strategy). No production code file is created.

## Implementation Plan
### Phase 1: Foundation — remove the alias from the code paths
Eliminate the two behavioral touch-points of `GITHUB_PERSONAL_ACCESS_TOKEN` so `GITHUB_PAT` is the only name the framework reads or forwards.

- In `adws/core/environment.ts`, change line 95 from `export const GITHUB_PAT = process.env.GITHUB_PAT || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;` to `export const GITHUB_PAT = process.env.GITHUB_PAT;`.
- In the same file, delete the `'GITHUB_PERSONAL_ACCESS_TOKEN',` line from the `SAFE_ENV_VARS` array (line 161). Leave `'GH_TOKEN'` and `'GITHUB_PAT'` in place.
- In `adws/healthCheckChecks.ts`, change line 52 to `const optional = ['CLAUDE_CODE_PATH', 'GITHUB_PAT'];`.

### Phase 2: Documentation consolidation & operator guidance
Remove the stale two-name references and add the token-type recommendation plus the breaking-change note.

- Collapse both references in `app_docs/feature-hjcays-fix-board-pat-auth.md` (lines 46 and 54) to `GITHUB_PAT` only.
- Collapse the env-var snippet in `specs/issue-446-adw-hjcays-ensurecolumns-fails-sdlc_planner-fix-board-pat-auth.md` (line 47) to `export const GITHUB_PAT = process.env.GITHUB_PAT;`.
- Add the classic-PAT-with-`project`-scope recommendation to `.env.sample` (near the `GITHUB_PAT` example).
- Extend the README `GITHUB_PAT` bullet (line 195) with the same recommendation and the operator-visible migration note (`GITHUB_PERSONAL_ACCESS_TOKEN` is no longer read).

### Phase 3: Verification
Pin the new behavior and prove zero regressions.

- Add `adws/core/__tests__/environment.test.ts` covering `getSafeSubprocessEnv()` (alias excluded, canonical var forwarded).
- The `scenario_writer` phase authors the per-issue BDD scenarios (`features/per-issue/feature-535.feature`, tagged `@adw-535`) describing the behavioral contract (see Testing Strategy → Edge Cases). Scenarios must be phrased behaviorally (subprocess-env contents, health-check output), not as source-string assertions, per the rot-prevention rule in `scenario_writer`.
- Run every command in **Validation Commands** and confirm a clean run.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Remove the alias fallback in `environment.ts`
- Open `adws/core/environment.ts`.
- Replace line 95 `export const GITHUB_PAT = process.env.GITHUB_PAT || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;` with `export const GITHUB_PAT = process.env.GITHUB_PAT;`.
- Leave the JSDoc on the preceding line as-is (it already reads "GitHub Personal Access Token (optional, gh CLI handles auth)").

### 2. Remove the alias from the `SAFE_ENV_VARS` allowlist
- In `adws/core/environment.ts`, delete the line `'GITHUB_PERSONAL_ACCESS_TOKEN',` (line 161) from the `SAFE_ENV_VARS` array.
- Confirm `'GH_TOKEN'` and `'GITHUB_PAT'` remain in the array and the array still type-checks as `readonly string[]`.

### 3. Remove the alias from the health-check optional list
- In `adws/healthCheckChecks.ts`, change line 52 to `const optional = ['CLAUDE_CODE_PATH', 'GITHUB_PAT'];`.

### 4. Collapse two-name references in the board-PAT app_doc
- In `app_docs/feature-hjcays-fix-board-pat-auth.md` line 46, change `Ensure \`GITHUB_PAT\` (or \`GITHUB_PERSONAL_ACCESS_TOKEN\`) is set in the ADW \`.env\` / environment.` to `Ensure \`GITHUB_PAT\` is set in the ADW \`.env\` / environment.`.
- In the configuration table (line 54), change the row key `\`GITHUB_PAT\` / \`GITHUB_PERSONAL_ACCESS_TOKEN\`` to `\`GITHUB_PAT\`` and clarify the purpose cell to "Personal access token with `project` scope (classic PAT recommended); used when the GitHub App token is refused by Projects V2".

### 5. Collapse the reference in the issue-446 spec
- In `specs/issue-446-adw-hjcays-ensurecolumns-fails-sdlc_planner-fix-board-pat-auth.md` line 47, change the snippet to `export const GITHUB_PAT = process.env.GITHUB_PAT;` and drop the stale `(line 70)` reference, keeping the trailing "No changes needed." note.

### 6. Add the classic-PAT recommendation to `.env.sample`
- In `.env.sample`, above the commented `# GITHUB_PAT="ghp_..."` example (lines 8-9), add a comment recommending a classic PAT with the `project` scope and noting that fine-grained `github_pat_...` tokens are unreliable against Projects V2 GraphQL on user-owned boards. Keep the example commented out.

### 7. Update the README `GITHUB_PAT` entry
- In `README.md` line 195, extend the `GITHUB_PAT` bullet to: keep the existing "(Optional) … only needed if using a different account than `gh auth login`" text, then add the classic-PAT-with-`project`-scope recommendation (fine-grained tokens unreliable against Projects V2 on user-owned boards) and the migration note: the legacy `GITHUB_PERSONAL_ACCESS_TOKEN` alias is no longer read — operators must set `GITHUB_PAT`.

### 8. Add unit tests for the subprocess allowlist
- Create `adws/core/__tests__/environment.test.ts`.
- Add a `describe('getSafeSubprocessEnv', …)` block with `beforeEach`/`afterEach` that snapshots and restores `process.env.GITHUB_PAT` and `process.env.GITHUB_PERSONAL_ACCESS_TOKEN` so tests do not leak env state.
- Test A — alias excluded: set `process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'ghp_legacy'`, call `getSafeSubprocessEnv()`, assert the returned object has no `GITHUB_PERSONAL_ACCESS_TOKEN` key. This is the regression guard for the `SAFE_ENV_VARS` removal.
- Test B — canonical forwarded: set `process.env.GITHUB_PAT = 'ghp_canonical'`, call `getSafeSubprocessEnv()`, assert `result.GITHUB_PAT === 'ghp_canonical'`.
- (Optional, only if cleanly isolable) Test C — `GITHUB_PAT` const resolves solely from `process.env.GITHUB_PAT`: use `vi.resetModules()` + dynamic `import('../environment')` with `process.env.GITHUB_PAT` unset and `process.env.GITHUB_PERSONAL_ACCESS_TOKEN` set, asserting the exported `GITHUB_PAT` is `undefined`. Note the dotenv caveat: `environment.ts` calls `dotenv.config()` at import, which does not override already-set vars but will load `.env` from cwd; if a host `.env` defines `GITHUB_PAT` the test is non-deterministic. Prefer stubbing `dotenv` (`vi.mock('dotenv', …)`) or skip Test C and rely on Tests A/B + the BDD scenarios. Do not add a flaky test.

### 9. Validate
- Run every command in **Validation Commands**. Every command must complete with zero errors and no new warnings.

## Testing Strategy
### Unit Tests
(Unit tests are enabled per `.adw/project.md` — `## Unit Tests: enabled`.)

Add `adws/core/__tests__/environment.test.ts` targeting `getSafeSubprocessEnv()`, the one pure, deterministic function whose output encodes the change:

- **Alias is not forwarded** — with `GITHUB_PERSONAL_ACCESS_TOKEN` present in `process.env`, `getSafeSubprocessEnv()` returns an object without that key. Direct regression guard for the `SAFE_ENV_VARS` edit.
- **Canonical var is forwarded** — with `GITHUB_PAT` present, `getSafeSubprocessEnv()` includes `GITHUB_PAT` with the same value.

Snapshot/restore the two env vars in `beforeEach`/`afterEach` so the suite is order-independent and leak-free. Do not mock `child_process` or `gh` — the function under test is pure with respect to the OS. Keep the optional module-reset test (`GITHUB_PAT` const) only if it can be made deterministic against `dotenv.config()`; otherwise omit it rather than introduce flakiness (the coding guidelines treat unreliable tests as worse than none).

### Edge Cases
- **Only the legacy alias is set** — an operator with `GITHUB_PERSONAL_ACCESS_TOKEN` but no `GITHUB_PAT` now gets `GITHUB_PAT === undefined`. This is the intended operator-visible breaking change; PAT-swap in `projectBoardApi.ts`/`githubBoardManager.ts` and personal-identity PR approval silently no-op (the app/`gh` token is used instead). Must be documented in the README and PR body, not "fixed".
- **Both vars set** — `GITHUB_PAT` wins (it always did, via the old `||` short-circuit); behavior is unchanged.
- **Neither set** — `GITHUB_PAT === undefined`; `gh` CLI auth handles GitHub access; unchanged.
- **Empty-string `GITHUB_PAT`** — falsy, so the `projectBoardApi.ts` swap guard (`GITHUB_PAT && …`) skips; unchanged from prior behavior.
- **Health check** — `checkEnvironmentVariables()` no longer lists `GITHUB_PERSONAL_ACCESS_TOKEN` among recognized optional vars; an operator who set only the alias sees neither it nor `GITHUB_PAT` reported as present.

## Acceptance Criteria
- `adws/core/environment.ts` defines `export const GITHUB_PAT = process.env.GITHUB_PAT;` with no `GITHUB_PERSONAL_ACCESS_TOKEN` fallback.
- `SAFE_ENV_VARS` in `adws/core/environment.ts` contains `GITHUB_PAT` and `GH_TOKEN` but not `GITHUB_PERSONAL_ACCESS_TOKEN`.
- `adws/healthCheckChecks.ts` optional-vars list contains `GITHUB_PAT` but not `GITHUB_PERSONAL_ACCESS_TOKEN`.
- A repository-wide search for `GITHUB_PERSONAL_ACCESS_TOKEN` returns zero matches in code and documentation (the two app_docs/specs references are collapsed to `GITHUB_PAT`).
- `.env.sample` and the README's `GITHUB_PAT` entry recommend a classic PAT with the `project` scope and note that fine-grained tokens are unreliable against Projects V2 on user-owned boards.
- The README records the operator-visible breaking change (the legacy alias is no longer read).
- New unit tests in `adws/core/__tests__/environment.test.ts` prove `getSafeSubprocessEnv()` excludes the alias and forwards `GITHUB_PAT`.
- `adws/github/projectBoardApi.ts`, `adws/providers/github/githubBoardManager.ts`, and `adws/github/prApi.ts` are unmodified (the PAT-swap behavior is a non-goal).
- All commands in **Validation Commands** pass with zero errors and zero new warnings.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — install dependencies (no new dependencies are added; run to confirm a clean lockfile state).
- `bun run lint` — ESLint must pass on all modified files (catches the unused-import/dead-code rule if anything was left dangling).
- `bunx tsc --noEmit` — root TypeScript typecheck passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws-scoped TypeScript typecheck passes.
- `bun run build` — project build succeeds.
- `bun run test:unit` — Vitest unit suite, including the new `environment.test.ts`, all pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — full regression BDD suite passes (confirms no collateral break to PAT-swap / board / auth scenarios).
- `! grep -rn "GITHUB_PERSONAL_ACCESS_TOKEN" adws/ app_docs/ specs/ README.md .env.sample` — final guard: the alias appears nowhere in code or docs (command exits non-zero if any match is found, so the leading `!` makes a clean tree pass). Exclude this plan file itself (`specs/issue-535-…`) from the check, since its embedded `issueJson` legitimately quotes the alias.

## Notes
- `.adw/coding_guidelines.md` applies: the edits are deletions plus small doc additions and stay well under the 300-line file limit; no refactor is required. Run `bun run lint` to enforce the "remove unused variables/imports" hygiene rule — verify nothing else referenced the removed allowlist entry.
- Library install command (per `.adw/commands.md`): `bun add <package>`. **No new libraries are required** for this change.
- **Type safety:** both operands of the removed `||` were `string | undefined`, so `GITHUB_PAT` keeps the exact type `string | undefined`. Every consumer (`projectBoardApi.ts`, `githubBoardManager.ts`, `prApi.ts`, `healthCheckChecks.ts`) already handles the `undefined` case via truthiness guards, so no consumer needs changes.
- **PR body requirement (issue-mandated):** the `/pull_request` phase must call out the operator-visible breaking change — anyone whose `.env` sets only `GITHUB_PERSONAL_ACCESS_TOKEN` loses PAT-swap behavior for Projects V2 and personal-identity PR approval after merge. The `/document` phase's generated `app_docs/` entry should carry the same note plus the classic-PAT recommendation.
- **Scenario authoring (rot-prevention):** `scenario_writer` refuses scenarios that assert against file existence/contents/source structure. Frame the `@adw-535` per-issue scenarios behaviorally — e.g. "the legacy alias is not forwarded to the Claude CLI subprocess environment" and "the health check recognizes `GITHUB_PAT` as the only GitHub PAT optional variable" — which map onto `getSafeSubprocessEnv()` and `checkEnvironmentVariables()` observable behavior.
- **Historical-doc edit rationale:** editing the issue-446 spec and the hjcays app_doc is unusual (they are point-in-time records) but is explicitly requested by the issue to keep a repo-wide search for the alias clean. The edits only collapse the env-var name; they do not rewrite the historical narrative.
