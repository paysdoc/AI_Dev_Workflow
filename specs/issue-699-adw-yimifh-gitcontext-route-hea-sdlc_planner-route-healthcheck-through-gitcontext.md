# Feature: Route health-check diagnostics through a self-host GitContext

## Metadata
issueNumber: `699`
adwId: `yimifh-gitcontext-route-hea`
issueJson: `{"number":699,"title":"GitContext: route health-check diagnostics through a self-host context","body":"## Parent PRD\n`specs/prd/git-context-repo-authority.md`\n\n## What to build\nConstruct a self-host GitContext in the diagnostic scripts and route their git/gh probes through it (healthCheckChecks has 8 sites), removing their ALLOWLIST entries. The PRD allows no exemption outside the package — diagnostics included.\n\n## Acceptance criteria\n- [ ] healthCheckChecks, healthCheck route through a GitContext\n- [ ] Those files removed from `ALLOWLIST`\n- [ ] `lint:git-guard` passes; health check still works\n\n## Blocked by\n- Blocked by #695\n\n## Touched Files\n- adws/healthCheckChecks.ts\n- adws/healthCheck.tsx\n- adws/gitContext/gitContext.ts\n- adws/checkGitGhGuard.ts\n\n## User stories addressed\n- User story 5\n- User story 8","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-23T11:45:33Z","comments":[],"actionableComment":null}`

## Feature Description
The ADW health-check diagnostic (`adws/healthCheck.tsx` + its predicates in `adws/healthCheckChecks.ts`) is one of the last two non-package files still allowed to shell out to `git`/`gh` directly. It currently runs eight raw `git`/`gh` probes via the local `execCommand` helper (e.g. `git rev-parse`, `git remote`, `git status --porcelain`, `git config user.name/email`, `gh auth status`, `gh issue view`, `gh repo view --json url`). Because of that, both files sit on the `ALLOWLIST` in `adws/checkGitGhGuard.ts` under the "diagnostic" exemption category.

The parent PRD (`specs/prd/git-context-repo-authority.md`) makes routing through `GitContext` an enforced invariant: "The package exposes **no context-free way** to run git or `gh`. A CI/lint guard fails the build if any code outside the package shells out to `git` or `gh` directly." The issue is explicit that this allows **no exemption outside the package — diagnostics included**.

This feature constructs a **self-host `GitContext`** at the diagnostic entry points and routes every git/gh probe through context methods, then deletes the two diagnostic entries from the guard `ALLOWLIST`. The value: the wrong-repo / token-bleed bug class becomes unrepresentable in the health check too, and the guard's "diagnostic (permanent)" loophole is closed, leaving only the genuine bootstrap and residual exemptions.

## User Story
As an ADW maintainer (PRD user stories 5 and 8)
I want the health-check diagnostics to obtain git/gh access only through a `GitContext`, and the build to fail if they ever shell out directly again
So that even tooling scripts cannot reintroduce the wrong-repo / token-bleed class of bug, and the "route through the context" guarantee is enforced mechanically with no diagnostic carve-out.

## Problem Statement
`adws/healthCheckChecks.ts` and `adws/healthCheck.tsx` shell out to `git`/`gh` directly through a local `execCommand(cmd)` helper. The CI guard (`adws/checkGitGhGuard.ts`, run via `bun run lint:git-guard` and `.github/workflows/git-cli-guard.yml`) detects any call expression whose first argument is a `git `/`gh ` command string, so both files are kept on the `ALLOWLIST` under a permanent "diagnostic" category. This is a standing exemption from the PRD's core invariant — direct git/gh access derived ad hoc at the call site, the exact pattern the PRD eliminates everywhere else. The PRD and issue require diagnostics to be migrated like every other consumer, with the allowlist entries removed so the exemption can no longer hide a future regression.

## Solution Statement
Construct a self-host `GitContext` once at each diagnostic entry point and thread it into the predicate functions, exactly as the existing tooling precedent `adws/checkLivingDocsIndex.ts` already does (`gitContextForRepo(readLocalRepoInfo(), { selfHost: true })`). Replace each of the eight raw `git`/`gh` probes with the equivalent `GitContext` method:

- Reuse existing context methods where they already exist (`getCurrentBranch`, `hasUncommittedChanges`, `authenticatedUser`, `fetchIssue`), and derive the repo URL from the context's `owner`/`repo` identity instead of probing `gh repo view`.
- Add two small read methods to `GitContext` for the two probes with no existing equivalent — `remotes()` (`git remote`) and `gitConfigUser()` (`git config user.name`/`user.email`) — following the inline style of the existing `remoteUrl()` / `authenticatedUser()` / `defaultBranch()` methods. (`adws/gitContext/gitContext.ts` is explicitly in the issue's Touched Files, confirming the new-method approach.)

The predicate signatures that touch git/gh (`checkGitRepository`, `checkGitHubCLI`, `checkIssueNumber`) gain a `GitContext` parameter; the three predicates that don't touch git/gh (`checkEnvironmentVariables`, `checkClaudeCodeCLI`, `checkDirectoryStructure`) are unchanged. Both callers of these predicates — `adws/healthCheck.tsx` **and** the `/health` endpoint in `adws/triggers/trigger_webhook.ts` — construct the self-host context and pass it down. Construction is wrapped so a missing token degrades gracefully instead of crashing the diagnostic. Finally, the two diagnostic entries are removed from the `ALLOWLIST` and the now-empty "diagnostic" category comment is cleaned up; `bun run lint:git-guard` then passes with the files fully scanned.

## Relevant Files
Use these files to implement the feature:

- `adws/healthCheckChecks.ts` — **edit.** Holds the predicate functions with the 7 in-file raw probes (lines ~103, 107, 112, 116, 117, 184, 254). Migrate `checkGitRepository`, `checkGitHubCLI`, `checkIssueNumber` to take a `GitContext` and route through its methods. Keep `execCommand` (still used at line ~156 for `${resolvedPath} --version`, the Claude CLI version probe, which is not a git/gh command and not guard-flagged) and `commandExists` (uses `which`, not guard-flagged).
- `adws/healthCheck.tsx` — **edit.** The orchestrator `main()`. Constructs the self-host `GitContext`, threads it into the three migrated predicates, replaces the `gh repo view --json url` probe (line ~225) by building the URL from `ctx.owner`/`ctx.repo`, and drops the now-unused `getRepoInfo` import. Also re-exports the predicates, so update the export list to match new signatures.
- `adws/gitContext/gitContext.ts` — **edit.** Add two inline read methods: `remotes(cwd?)` → `git remote` and `gitConfigUser(cwd?)` → `git config user.name`/`user.email` (returns `{ name, email }` with per-field `null` on unset). Mirror the existing inline `remoteUrl()` / `authenticatedUser()` / `defaultBranch()` methods that call `this.#run(...)` directly. These command strings live inside the package directory (structurally guard-exempt).
- `adws/checkGitGhGuard.ts` — **edit.** Remove the two diagnostic `ALLOWLIST` entries (`adws/healthCheckChecks.ts`, `adws/healthCheck.tsx`) and the now-empty `// diagnostic — …` category header; update the categories doc-comment (line ~38) to drop "diagnostic (permanent)".
- `adws/triggers/trigger_webhook.ts` — **edit (5th file, not in the issue's Touched Files but required).** Its `/health` HTTP endpoint (lines ~70–84) calls `checkGitRepository()` and `checkGitHubCLI()` with no args. Construct the self-host `GitContext` (guarded) and pass it to both, mirroring `healthCheck.tsx`.
- `adws/github/gitContextFactory.ts` — **read-only reference.** Source of `gitContextForRepo(repoInfo, { selfHost: true })` and `readLocalRepoInfo()` — the exact construction helpers the precedent uses. Note `gitContextForRepo` resolves the token via App-auth → `GH_TOKEN` → `gh auth token`, and `GitContext` requires a non-empty token at construction (mandatory-token contract — do not weaken).
- `adws/checkLivingDocsIndex.ts` — **read-only precedent.** The closest analog: a tooling script that already builds a self-host context with `gitContextForRepo(readLocalRepoInfo(), { selfHost: true })` and routes a git read (`ctx.lsFiles(process.cwd())`) through it. Mirror its construction and its use of `process.cwd()` as the explicit `cwd`.
- `adws/gitContext/commands/issueCommands.ts` — **read-only reference.** Confirms `fetchIssueCmd` requests `number,title,state,…` (`ISSUE_FIELDS`), so `ctx.fetchIssue(issueNumber)` returns JSON parseable for `title`/`state` in one call.

### New Files
- `adws/__tests__/healthCheckChecks.test.ts` — unit tests for the migrated predicates, injecting a fake/spy `GitContext` (the `adws/__tests__/` dir and `adws/**/__tests__/**/*.test.ts` vitest glob already exist).

### Conditional Documentation (read before implementing)
Per `.adw/conditional_docs.md`, these app-docs match this task and must be consulted:
- `app_docs/feature-9gjajh-health-check.md` — owns `adws/healthCheck.tsx` + `adws/healthCheckChecks.ts` (health-check orchestrator and predicates).
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — owns `adws/gitContext/**` + `adws/github/gitContextFactory.ts`; the GitContext deep-module conventions, `gitContextForRepo`, thin-method + package-private-op pattern, and the migration-off-the-ALLOWLIST pattern used by prior slices (#691/#693/#694/#695).
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — owns `adws/checkGitGhGuard.ts` + `.github/workflows/git-cli-guard.yml`; ALLOWLIST categories and the migrate-then-remove flow.
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — boundary-construction conventions (constructing one `GitContext` at a launch/entry boundary and threading it down).

## Implementation Plan
### Phase 1: Foundation — extend GitContext with the two missing read methods
Add the two read methods that the health check needs but the context does not yet expose, so every probe has a context method to route through. Both are thin `this.#run(...)` wrappers added inline in `adws/gitContext/gitContext.ts` alongside `remoteUrl()`/`authenticatedUser()`:
- `remotes(cwd?: string): string[]` — runs `git remote`, splits on newlines, trims, drops empties. Propagates on error (no git repo); the caller wraps in try/catch (consistent with `remoteUrl()`/`gitReadOps` "each call site handles its own try/catch").
- `gitConfigUser(cwd?: string): { name: string | null; email: string | null }` — reads `git config user.name` and `git config user.email`; an unset key (`git config` exits non-zero) is an expected non-error state for a diagnostic, so this method internally catches per-field and returns `null` for that field (analogous to `getWorktreeForBranch` returning `null`). Note: this reads the real git config (env-injected `GIT_AUTHOR_*` do not affect `git config` reads), preserving the original diagnostic's meaning.

### Phase 2: Core Implementation — migrate the predicates
In `adws/healthCheckChecks.ts`, change the three git/gh-touching predicates to accept a `GitContext` and route every probe through it:
- `checkGitRepository(ctx)`: keep the `fs.existsSync('.git')` early return (not a shell-out); then `ctx.getCurrentBranch(process.cwd())` (preserve `|| 'unknown'` for detached HEAD), `ctx.remotes(process.cwd())` (derive `hasRemote`/`remotes`, wrapped in try/catch → `false`/`[]`), `ctx.hasUncommittedChanges(process.cwd())`, and `ctx.gitConfigUser(process.cwd())` for `userName`/`userEmail`/`userConfigured` + the existing warning.
- `checkGitHubCLI(ctx)`: keep `commandExists('gh')` (uses `which`, unchanged) and the `GITHUB_PAT` check; replace `gh auth status` with `ctx.authenticatedUser()` in a try/catch (success + non-empty → authenticated). Preserve the "not authenticated and no PAT" warning.
- `checkIssueNumber(issueNumber, ctx)`: drop the `RepoInfo` parameter (the context carries `owner`/`repo`). Keep the numeric validation; replace the `gh issue view … --json number,title,state` probe with `ctx.fetchIssue(issueNumber)` (try/catch for not-found/inaccessible), parse `title`/`state` from the returned JSON.
- Leave `checkEnvironmentVariables`, `checkClaudeCodeCLI`, `checkDirectoryStructure`, `commandExists`, and `execCommand` unchanged.

### Phase 3: Integration — construct & thread the context at both entry points, remove the allowlist entries
- `adws/healthCheck.tsx` `main()`: construct `const ctx = gitContextForRepo(readLocalRepoInfo(), { selfHost: true })` (mirroring `checkLivingDocsIndex.ts`), wrapped in try/catch so a token-resolution failure is reported as a clear error rather than crashing the run. Pass `ctx` into `checkGitRepository`, `checkGitHubCLI`, and `checkIssueNumber`. Replace the issue-link's `gh repo view --json url` probe with `https://github.com/${ctx.owner}/${ctx.repo}` built from context identity. Remove the now-unused `getRepoInfo` import and update the re-export block to the new signatures.
- `adws/triggers/trigger_webhook.ts` `/health` endpoint: construct the same self-host context (guarded with try/catch so the endpoint still returns a JSON health report on failure) and pass it to `checkGitRepository`/`checkGitHubCLI`.
- `adws/checkGitGhGuard.ts`: delete the two diagnostic `ALLOWLIST` lines and the `// diagnostic — …` section header; update the category doc-comment to list only `bootstrap (permanent), residual (temporary)`.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1 — Read conditional docs and confirm context
- Read `app_docs/feature-9gjajh-health-check.md`, `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`, `app_docs/feature-bq1f45-git-gh-cli-guard.md`, and `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md`.
- Re-read `adws/checkLivingDocsIndex.ts` (precedent) and `adws/github/gitContextFactory.ts` (`gitContextForRepo`, `readLocalRepoInfo`).

### Task 2 — Add `remotes()` and `gitConfigUser()` to GitContext
- In `adws/gitContext/gitContext.ts`, add inline (near `remoteUrl()`):
  - `remotes(cwd?: string): string[]` → `this.#run('git remote', { cwd }).split('\n').map(s => s.trim()).filter(Boolean)`.
  - `gitConfigUser(cwd?: string): { name: string | null; email: string | null }` → a private read-one helper that runs `git config user.name` / `git config user.email` via `this.#run(..., { cwd })` and returns `null` on throw; assemble `{ name, email }`.

### Task 3 — Add GitContext unit tests for the new methods
- In `adws/gitContext/__tests__/gitContext.test.ts`, add tests using `new GitContext(validOptions({ selfHost: true }), { exec: fakeExec })`:
  - `remotes()` issues `git remote` (assert command + `cwd` from the captured exec call) and parses multi-line output into a trimmed, empty-filtered array.
  - `gitConfigUser()` returns `{ name, email }` from the two config reads, and returns `null` for a field whose `exec` throws (unset key).
  - Reuse the existing exec-injection / env-injection assertions in that file (confirm no `process.env` mutation).

### Task 4 — Migrate `checkGitRepository`
- Change signature to `checkGitRepository(ctx: GitContext): CheckResult`; import `GitContext` type (e.g. `import type { GitContext } from './gitContext/gitContext'`).
- Replace the four git probes with `ctx.getCurrentBranch(process.cwd())`, `ctx.remotes(process.cwd())` (try/catch → `hasRemote`/`remotes`), `ctx.hasUncommittedChanges(process.cwd())`, and `ctx.gitConfigUser(process.cwd())`. Preserve existing `details` keys, the `'unknown'` branch fallback, and the user-config warning.

### Task 5 — Migrate `checkGitHubCLI`
- Change signature to `checkGitHubCLI(ctx: GitContext): CheckResult`.
- Keep `commandExists('gh')` and `GITHUB_PAT`. Replace `gh auth status` with a try/catch around `ctx.authenticatedUser()` to set `details.authenticated`. Preserve the warning logic.

### Task 6 — Migrate `checkIssueNumber`
- Change signature to `checkIssueNumber(issueNumber: number, ctx: GitContext): CheckResult` (remove the `RepoInfo` param and its import if now unused).
- Keep numeric validation; replace the `gh issue view` probe with a try/catch around `ctx.fetchIssue(issueNumber)`, parsing `title`/`state`; on throw or unparseable output return the existing "not found / not accessible" failure.

### Task 7 — Update `healthCheck.tsx` orchestrator
- Import `gitContextForRepo` + `readLocalRepoInfo` (from `./github/gitContextFactory`).
- In `main()`, build `ctx` via `gitContextForRepo(readLocalRepoInfo(), { selfHost: true })` inside a try/catch; on failure, record a clear error in the result, mark `success = false`, and skip the three context-dependent checks (still run env/claude/directory checks) so the diagnostic reports instead of crashing.
- Pass `ctx` to `checkGitRepository`, `checkGitHubCLI`, `checkIssueNumber`.
- Replace the `execCommand('gh repo view --json url -q .url')` issue link with `const repoUrl = `https://github.com/${ctx.owner}/${ctx.repo}``.
- Remove the unused `getRepoInfo` import; update the `export { … }` re-export block to keep exports valid (predicates still exported; `execCommand`/`commandExists` retained).

### Task 8 — Update the webhook `/health` endpoint
- In `adws/triggers/trigger_webhook.ts`, construct the self-host `GitContext` (guarded with try/catch) inside the `/health` handler and pass it to `checkGitRepository(ctx)` and `checkGitHubCLI(ctx)`. On construction failure, populate those two checks with a failed `CheckResult` so the endpoint still returns a 200 JSON report.

### Task 9 — Remove the diagnostic ALLOWLIST entries
- In `adws/checkGitGhGuard.ts`, delete the `// diagnostic — …` header and its two entries (`adws/healthCheckChecks.ts`, `adws/healthCheck.tsx`). Update the `ALLOWLIST` doc-comment categories to `bootstrap (permanent), residual (temporary)`.

### Task 10 — Add health-check predicate unit tests
- Create `adws/__tests__/healthCheckChecks.test.ts`. Inject a fake `GitContext` (a minimal object/stub exposing only the methods each predicate calls — `getCurrentBranch`, `remotes`, `hasUncommittedChanges`, `gitConfigUser`, `authenticatedUser`, `fetchIssue`, `owner`, `repo`), cast as needed. Cover:
  - `checkGitRepository`: happy path (branch/remote/clean/user populated); degraded (`remotes` throws → `hasRemote:false`; `gitConfigUser` → nulls → warning).
  - `checkGitHubCLI`: authenticated (resolves) vs not (`authenticatedUser` throws) with/without PAT.
  - `checkIssueNumber`: valid issue (parses title/state); invalid number; `fetchIssue` throws → not-found failure.
- Verify `adws/__tests__/triggerWebhook.test.ts` still passes (update it if it exercises `/health`).

### Task 11 — Run the validation commands
- Run every command in **Validation Commands** and confirm all pass with zero regressions — especially `bun run lint:git-guard` (proves the allowlist removal is clean) and the live health-check run.

## Testing Strategy
### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.
- **GitContext methods** (`adws/gitContext/__tests__/gitContext.test.ts`): inject a fake `exec` and assert `remotes()` runs `git remote` with the right `cwd` and parses output; assert `gitConfigUser()` returns `{ name, email }` and yields `null` per field when the read throws; reuse the file's existing no-`process.env`-mutation assertion to confirm the new methods inherit per-command env injection.
- **Health-check predicates** (`adws/__tests__/healthCheckChecks.test.ts`, new): drive `checkGitRepository`, `checkGitHubCLI`, `checkIssueNumber` with a spy/fake `GitContext`, asserting the `CheckResult` shape (`success`, `error`, `warning`, `details`) across success and degraded/failure paths (remote-missing, user-unset, unauthenticated, issue-not-found). This is net-new coverage — these predicates had no tests because they previously shelled out directly; the migration makes them injectable.
- Run the suite with `bun run test:unit`.

### Edge Cases
- **Detached HEAD**: `getCurrentBranch` (`git branch --show-current`) returns empty → `currentBranch` falls back to `'unknown'`.
- **No `origin` remote**: `ctx.remotes()` returns `[]` (or throws if not a repo) → `hasRemote:false`, `remotes:[]`, no crash.
- **Git user unset**: `gitConfigUser()` returns `{ name:null, email:null }` → `userConfigured:false` + warning (unchanged behavior).
- **`gh` unauthenticated / no PAT**: `authenticatedUser()` throws → `authenticated:false` + warning.
- **Issue not found / inaccessible**: `fetchIssue` throws or returns non-JSON → existing "not found or not accessible" failure result.
- **GitContext construction fails (no resolvable token)**: both entry points catch the throw and report a clear error instead of crashing — the diagnostic still produces a report (mandatory-token contract preserved; not weakened).
- **Run from a worktree vs repo root**: passing `process.cwd()` as the explicit `cwd` to the git reads preserves "inspect the current directory's repo" semantics even though the self-host base path is the framework repo root.

## Acceptance Criteria
- `checkGitRepository`, `checkGitHubCLI`, and `checkIssueNumber` in `adws/healthCheckChecks.ts`, and the orchestrators `adws/healthCheck.tsx` and the webhook `/health` endpoint, obtain all git/gh access through a self-host `GitContext`; no `git`/`gh` command strings remain in those files.
- `adws/healthCheckChecks.ts` and `adws/healthCheck.tsx` are removed from the `ALLOWLIST` in `adws/checkGitGhGuard.ts`, and the empty "diagnostic" category is cleaned up.
- `bun run lint:git-guard` exits 0 with both files now scanned (not allowlisted) and no violations.
- The health check still works end-to-end: `bunx tsx adws/healthCheck.tsx 699` runs all checks and writes `healthCheck.jsonl` without throwing.
- `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run build`, and `bun run test:unit` all pass with zero regressions (including the webhook `/health` change).

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint:git-guard` — Git/GH CLI guard; **must pass** with `adws/healthCheckChecks.ts` and `adws/healthCheck.tsx` no longer allowlisted (proves the migration removed every direct shell-out).
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the `adws/` project (catches the new `GitContext` params and method signatures).
- `bunx tsc --noEmit` — Repo-wide type check.
- `bun run lint` — ESLint across the repo.
- `bun run test:unit` — Vitest unit suite, including the new `remotes()`/`gitConfigUser()` tests and the new `healthCheckChecks.test.ts`.
- `bun run build` — `tsc` build to verify no build errors.
- `bunx tsx adws/healthCheck.tsx 699` — Run the live health check; confirm it completes, prints the results table, and writes `healthCheck.jsonl` (exit code reflects health, not a crash).

## Notes
- `.adw/coding_guidelines.md` was not found in this repo; follow existing in-file conventions (deep-module `GitContext`, thin `this.#run(...)` methods, I/O-at-the-boundary structure already used in `healthCheckChecks.ts` and `checkLivingDocsIndex.ts`). No decorators; keep methods simple.
- **No new libraries required** — the change reuses `gitContextForRepo`/`readLocalRepoInfo` and the existing `GitContext`. (Library install command, if ever needed, per `.adw/commands.md`: `bun add <package>`.)
- **Fifth file beyond the issue's Touched Files**: `adws/triggers/trigger_webhook.ts` imports `checkGitRepository`/`checkGitHubCLI` for its `/health` endpoint, so the signature change forces an edit there. This is required for the build to compile and is in scope.
- **Mandatory-token contract**: `GitContext` requires a non-empty token at construction (`gitContextForRepo` → `resolveToken`), so the diagnostics now require a resolvable token (App auth / `GH_TOKEN` / `gh auth token`) to run their git/gh checks — the same coupling the precedent `checkLivingDocsIndex.ts` accepts. Do **not** weaken this; instead handle construction failure gracefully at the entry points. On a configured ADW host a token always resolves via `gh auth token`.
- **Why some probes don't add methods**: `getCurrentBranch`, `hasUncommittedChanges`, `authenticatedUser`, and `fetchIssue` already exist; the repo URL is derived from `ctx.owner`/`ctx.repo` (identical to what `gh repo view --json url` returns) rather than a new probe — minimizing surface while still removing every shell-out. Only `remotes()` and `gitConfigUser()` are genuinely new.
- **`execCommand`/`commandExists` stay**: `execCommand` is still used for `${resolvedPath} --version` (Claude CLI, not git/gh) and `commandExists` uses `which` — neither is flagged by the guard, so both remain.
- This is slice #699 of the GitContext epic, following the same migrate-then-remove-from-ALLOWLIST pattern as #691/#693/#694/#695; after it lands, the guard's only remaining exemptions are the permanent bootstrap entries and the residual (temporary) ones.
