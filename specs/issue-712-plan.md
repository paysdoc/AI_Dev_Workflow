# PR-Review: Route `readRemoteAdwVersion`'s `git show` through GitContext (git-guard violation on PR #715)

## PR-Review Description
The CI check `bun run lint:git-guard` (`bunx tsx adws/checkGitGhGuard.ts`) fails on PR #715 with a single violation:

```
adws/core/adwVersion.ts:70  git show "origin/${...}

Remedy: route through GitContext, or add to ALLOWLIST in adws/checkGitGhGuard.ts with justification.
```

`readRemoteAdwVersion` (added in this PR) shells out directly via `execSync(`git show "origin/${defaultBranch}:${ADW_VERSION_FILENAME}"`, …)` at `adws/core/adwVersion.ts:70`. The Git/GH CLI Guard (`adws/checkGitGhGuard.ts`) AST-scans every non-test `.ts/.tsx` source outside `adws/gitContext/**` and the `ALLOWLIST`, flagging any call whose first argument is a `git `/`gh ` command string. The new raw `git show` is exactly such a call and is neither inside the structurally-exempt GitContext package nor on the allowlist, so the build fails.

The reviewer's comment — *"Did you forget to route it through the GitContext?"* — explicitly asks for the **route-through-GitContext** remedy, not an ALLOWLIST exemption. The framework is mid-migration to making `GitContext` (`adws/gitContext/`) the single authority for all `git`/`gh` I/O (PRD: GitContext repo-context authority; #658–#666, #694, #696, #699), so routing is also the architecturally correct fix. The original plan's "GitContext design tension" note already anticipated this: *"add a `show(ref, file)` read-op to `gitReadOps`/`GitContext` and call it from `initializeWorkflow` (where `gitCtx` is already in scope)."*

**Decision: route through GitContext.** Add a `show` read-op to `gitReadOps`/`GitContext`, refactor `readRemoteAdwVersion` to delegate the git invocation to an injected reader (so the raw `git show` lives only inside the exempt GitContext package), thread the in-scope `gitCtx` into the gate deps, and drop the now-unused `child_process` import from `adwVersion.ts`. This removes the violation at its source — **no ALLOWLIST entry is added**, so the guard's `(N allowlisted)` count stays 5 and no downstream stdout-regex coupling is disturbed.

## Summary of Original Implementation Plan
The feature (issue #712) changes the framework self-upgrade gate's source of truth for the stored `.adw-version` from a local, possibly-stale worktree file to the **authoritative remote default branch** (`git show origin/<defaultBranch>:.adw-version`), and moves the gate to run **before** worktree setup. This eliminates the false-mismatch class of spurious upgrades (root cause behind vestmatic #197/#203) and parks losers without building a throwaway worktree. The PR added `readRemoteAdwVersion` to `adws/core/adwVersion.ts`, threaded a `defaultBranch` param through `UpgradeGateParams`/`UpgradeGateDeps`, reordered the gate in `adws/phases/workflowInit.ts`, and added unit coverage (`adwVersion.test.ts` uses a real hermetic git fixture per commit 514a1eb; `upgradeGate.test.ts` asserts the `(defaultBranch, workspacePath)` signature and the stale-worktree-but-remote-current → `proceed` case). The claim-push-needs-target-worktree invariant was preserved. The only outstanding defect is the git-guard violation addressed by this review.

## Relevant Files
Use these files to resolve the review:

- `adws/core/adwVersion.ts` — Holds the offending raw `execSync('git show …')` at line 70 (`readRemoteAdwVersion`). Must be refactored to delegate the git invocation to an injected reader and drop its `import { execSync } from 'child_process'` (becomes unused once the shell-out moves out). This is what makes the violation disappear at source.
- `adws/gitContext/gitReadOps.ts` — Package-private git-read op module (`lsFiles`, `headShort`, `diff`, `log`). Add a `show(run, ref, cwd)` op here, alongside the existing read ops. Inside `adws/gitContext/**`, so its raw `git show` string is structurally exempt from the guard.
- `adws/gitContext/gitContext.ts` — The `GitContext` deep module. Add a public `showFile(ref, cwd)` method in the "Git read ops" section that wires `gitReadOps.show` through the `#run` chokepoint (mirrors `headShort`/`diff`/`log`).
- `adws/phases/upgradeGate.ts` — `buildDefaultUpgradeGateDeps` currently calls `readRemoteAdwVersion(defaultBranch, workspacePath)` directly. Change it to accept a `GitContext` and build the gate's `readAdwVersion` dep from `gitCtx.showFile`. `runUpgradeGate`, `UpgradeGateParams`, `UpgradeGateDeps`, and `shouldTriggerUpgrade` are otherwise unchanged.
- `adws/phases/workflowInit.ts` — The gate call site already has `gitCtx` in scope (`const gitCtx = gitContextForSync(...)` at line 134; gate call at line 250). Pass `gitCtx` into `buildDefaultUpgradeGateDeps(gateRepoId, targetRepoWorkspacePath, gitCtx)`.
- `adws/checkGitGhGuard.ts` — Read-only reference: confirms the rule (`adws/gitContext` is the structurally-exempt package; `ALLOWLIST` is the escape hatch we are deliberately **not** using). No edit expected; the fix must make `scanFiles` report zero violations without an ALLOWLIST addition.

### Test Files
- `adws/core/__tests__/adwVersion.test.ts` — The `readRemoteAdwVersion` describe block currently drives a real hermetic git fixture calling `readRemoteAdwVersion('main', ws)`. With the signature change to an injected reader, rewrite these to either (a) pass a thin `show` function over the existing fixture (`(ref) => execSync(`git show "${ref}"`, { cwd: ws }).toString()` — tests are guard-exempt), or (b) inject a fake `show` (return value / empty / throws) to assert the pure null-handling deterministically. Keep coverage for success → trimmed hash, empty → null, throw/absent → null.
- `adws/gitContext/__tests__/gitReadOps.test.ts` — Add a `show()` describe block following the existing `makeSpyExec`/`validOptions` harness: assert the command string is `git show "<ref>"`, the supplied `cwd` is passed, `GH_TOKEN`/`GIT_*` env are injected, output is trimmed, and exec errors propagate.
- `adws/phases/__tests__/upgradeGate.test.ts` — Gate behaviour tests inject `readAdwVersion` directly via `makeDeps`, so `runUpgradeGate` tests are unaffected. If any test constructs `buildDefaultUpgradeGateDeps`, update it for the new `gitCtx` parameter (current grep shows only `runUpgradeGate`-via-`makeDeps` usage, so likely no change needed — verify).
- `adws/phases/__tests__/workflowInit.test.ts` — Mocks `buildDefaultUpgradeGateDeps: vi.fn()`, so the added argument is absorbed by the mock. Verify the gate-ordering/parked assertions still pass.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Task 1: Add a `show` read-op to `gitReadOps.ts`
- In `adws/gitContext/gitReadOps.ts`, add a `show(run: Runner, ref: string, cwd: string): string` function that returns `run(`git show "${ref}"`, cwd)`.
- Export it on the existing `gitReadOps` object (`export const gitReadOps = { lsFiles, headShort, diff, log, show };`).
- Keep the module's "all functions propagate errors — each call site handles its own try/catch" contract; do not swallow errors here.

### Task 2: Expose `GitContext.showFile(ref, cwd)`
- In `adws/gitContext/gitContext.ts`, in the "── Git read ops ──" section (near `lsFiles`/`headShort`/`diff`/`log`), add:
  `showFile(ref: string, cwd: string): string { return gitReadOps.show((cmd, c) => this.#run(cmd, { cwd: c }), ref, cwd); }`
- This routes the read through the single `#run` chokepoint (per-command env, never mutates `process.env`), consistent with the other read ops. `cwd` is explicit (the target clone root) because `origin` must resolve to the target remote.

### Task 3: Refactor `readRemoteAdwVersion` to delegate the git invocation
- In `adws/core/adwVersion.ts`, change the signature to `readRemoteAdwVersion(defaultBranch: string, showFile: (ref: string) => string): string | null`.
- Build the ref internally: `const ref = `origin/${defaultBranch}:${ADW_VERSION_FILENAME}`;`, then `const content = showFile(ref).trim(); return content.length > 0 ? content : null;` inside a `try { … } catch { return null; }` (preserve "absent/empty → null, never throws" semantics).
- Remove `import { execSync } from 'child_process';` (now unused — lint will fail otherwise).
- Update the JSDoc: still the authoritative, stale-worktree-immune read; now the actual `git show` is injected via `showFile` (routed through GitContext), keeping `adwVersion.ts` free of direct git shell-outs.

### Task 4: Thread `gitCtx` into the gate deps factory
- In `adws/phases/upgradeGate.ts`:
  - Add a `GitContext` type import from `../gitContext`.
  - Change `buildDefaultUpgradeGateDeps(repoId: RepoIdentifier, worktreePath: string, gitCtx: GitContext): UpgradeGateDeps`.
  - Wire the read dep: `readAdwVersion: (defaultBranch, workspacePath) => readRemoteAdwVersion(defaultBranch, (ref) => gitCtx.showFile(ref, workspacePath)),`.
  - Keep `import { readRemoteAdwVersion } from '../core/adwVersion';`. Leave `claimUpgrade`, the per-target claim invariant comment, and all winner/loser orchestration unchanged. `UpgradeGateParams`/`UpgradeGateDeps`/`runUpgradeGate`/`shouldTriggerUpgrade` are unchanged.

### Task 5: Pass `gitCtx` at the call site
- In `adws/phases/workflowInit.ts`, update the gate call (line ~250) to `buildDefaultUpgradeGateDeps(gateRepoId, targetRepoWorkspacePath, gitCtx)`. `gitCtx` is already constructed at line 134 and in scope; no other reorder needed.

### Task 6: Update tests
- `adws/gitContext/__tests__/gitReadOps.test.ts`: add a `describe('show() command and env', …)` block using `makeSpyExec`/`validOptions` — assert command `git show "<ref>"`, cwd passthrough, `GH_TOKEN` + four `GIT_*` env vars injected, output trimming, no `process.env` mutation, and error propagation.
- `adws/core/__tests__/adwVersion.test.ts`: update the `readRemoteAdwVersion` block for the injected-`show` signature. Either keep the hermetic git fixture and pass a thin `show` wrapper over it, or inject a fake `show` (return value / empty-string / throws). Retain the three semantic cases (success → trimmed hash, empty → null, absent/throw → null) and the "remote value not local" intent.
- `adws/phases/__tests__/upgradeGate.test.ts`: confirm the `runUpgradeGate` tests (which inject `readAdwVersion` via `makeDeps`) still pass unchanged. If any test calls `buildDefaultUpgradeGateDeps` directly, add a `gitCtx` (real `GitContext` with a spy exec, or a minimal stub exposing `showFile`).
- `adws/phases/__tests__/workflowInit.test.ts`: confirm the `buildDefaultUpgradeGateDeps: vi.fn()` mock absorbs the extra arg and the gate-ordering/parked tests stay green.

### Task 7: Run the Validation Commands
- Execute every command in the Validation Commands section below; all must pass with zero regressions. The git-guard command in particular must report `✔ PASS … (5 allowlisted)` with no violations.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `bun run lint:git-guard` — **The failing check.** Must now report `✔ PASS  No direct git/gh shell-outs outside GitContext.` and `(5 allowlisted)` (no new ALLOWLIST entry).
- `bun run lint` — Lint the codebase (catches the removed-`execSync` unused import and any other quality issues).
- `bunx tsc --noEmit` — Root type-check (strict mode); verifies the new `GitContext` param and `showFile` signatures.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` project type-check.
- `bunx vitest run adws/gitContext/__tests__/gitReadOps.test.ts adws/core/__tests__/adwVersion.test.ts adws/phases/__tests__/upgradeGate.test.ts adws/phases/__tests__/workflowInit.test.ts` — Targeted: the directly-affected suites.
- `bun run test:unit` — Full unit suite; zero regressions.
- `bun run build` — Build to verify no compile/build errors.

## Notes
- **Why route, not ALLOWLIST:** The reviewer explicitly asked for GitContext routing; it aligns with the GitContext-authority PRD; and it avoids touching `ALLOWLIST`, keeping the guard's `(5 allowlisted)` count stable (a prior memory flags that the `(N allowlisted)` stdout string is coupled to other tooling — do not perturb it). Routing also deletes the only `child_process` dependency from `adwVersion.ts`, leaving it a pure `fs`-only leaf.
- **`git show` needs no auth** — it reads from the local object DB of `targetRepoWorkspacePath` (whose `origin/<default>` ref was already fetched by `targetRepoManager`). Going through `#run` adds the standard env overlay harmlessly; behaviour is equivalent to the previous raw `execSync` with `cwd: workspacePath`.
- **Behaviour is unchanged** — same command (`git show "origin/<default>:.adw-version"`), same cwd, same null-on-absent/empty semantics, same gate ordering and claim-push invariant. This review is a pure I/O-routing refactor to satisfy the guard; the #712 feature semantics and acceptance criteria are untouched.
- **Mockability bonus** — injecting `showFile` makes `readRemoteAdwVersion`'s success path deterministically unit-testable without a real git repo, which also strengthens the test coverage the original plan flagged as weak.
- **Coding guidelines** — keep `show`/`showFile` as thin one-line ops matching the surrounding read-op style; `readRemoteAdwVersion` stays a small guard-clause/`try-catch`-returns-null leaf; explicit types, no `any`; all files remain well under the 300-line ceiling. No new libraries.
