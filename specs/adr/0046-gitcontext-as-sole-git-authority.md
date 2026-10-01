---
status: accepted
date: 2026-06-19
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/git-context-repo-authority.md
  - kind: contemporaneous
    source: "specs/issue-658-*.md to specs/issue-666-*.md (issues #658 to #666)"
  - kind: contemporaneous
    source: "specs/issue-691-*.md to specs/issue-701-*.md (issues #691 to #701)"
supersedes: []
superseded-by: []
---

# GitContext is the only way to run git or gh

## Context and Problem Statement

One host runs ADW against its own repository and against any number of target repositories. Every piece of code that runs `git` or `gh` must know which repository's filesystem it works on and which repository it is authenticated against. Both answers were worked out at each call site, with unsafe defaults:

* The worktree base path was an optional parameter that defaulted to the framework repository. Because ADW works on itself, the default was right in the most used path and failed only against target repositories.
* The token was applied by setting `GH_TOKEN` in the process environment, guarded by a module-level "currently authenticated repository". In the webhook server, interleaved events for different repositories overwrote it.

The PRD counts about 13 separate fixes of this kind in four months. An earlier centralisation moved the path computation into one function but left the optional parameter reachable, and a newer call site (orchestrator takeover) repeated the fault and left a production issue in a retry loop.

## Decision Drivers

* The wrong path must be "unrepresentable", not discouraged.
* Two repositories handled in one process must not see each other's token or directory.
* Workflows already in flight must survive the change without a migration of state files.

## Considered Options

* Keep fixing call sites and threading an optional base path (the approach that had regressed).
* A separate git service or daemon process.
* One in-process authority, `GitContext`, with mandatory identity and per-command environment.

## Decision Outcome

Chosen option: "One in-process authority", because it makes identity mandatory and removes every context-free way to run git or `gh`. The daemon was rejected: the only thing a process boundary added was isolation of the global token, which per-command environment injection gives in-process, and a daemon "would add IPC failure modes and a macOS process-lifecycle problem".

* A `GitContext` is built once at each process's launch boundary: from `--target-repo` arguments for cron and orchestrators (the local remote when absent), and from the event payload, per event, in the webhook.
* The constructor takes owner, repo, a self-host flag, credentials and git identity. There is no optional base path and no `cwd` fallback. The base path is resolved only there.
* Every operation is a method that spawns its command with an explicit `cwd` and an explicit child environment. The parent process environment is never changed for authentication.
* Repository identity is written to workflow state as a cross-check. The launch boundary stays the source of truth; a mismatch is an error.
* A CI guard fails the build when code outside the package shells out to `git` or `gh`.

### Consequences

* Good, because a new call site cannot reintroduce the wrong-repository fault; it has nothing to call without a context.
* Good, because state written before the change needs no backfill: a resuming process uses its own launch identity.
* Bad, because the migration was large: two waves of issues (#658 to #666, then #691 to #701) before the allowlist and the global token could be deleted (#701).
* Bad, because the guard matches identifier text. `adws/guard/identityRule.ts` records that an aliased import evades it.
* Bad, because the guard reports and does not block: the repository has no required status checks (ADR-0019, [0019-dev-and-main-branches-with-runner-clone.md](0019-dev-and-main-branches-with-runner-clone.md)).

### Confirmation

Checked on 2026-09-29:

* `bun run lint:git-guard` (`adws/checkGitGhGuard.ts`): 279 files scanned, 0 allowlisted, pass. `EXEMPT_PACKAGES` is empty. `features/`, `test/` and test files are outside the scan.
* `.github/workflows/git-cli-guard.yml` runs the guard on every push and pull request.
* `grep` for `execSync`, `spawn` and `execFileSync` calls with a `git` or `gh` command string in `adws/`, tests excluded, returns nothing. No assignment to `GH_TOKEN` in the process environment remains.
* `buildLaunchBoundary` in `adws/core/launchGitContext.ts` is the single construction site named in `SANCTIONED_CONSTRUCTION_SITES`.
* `adws/phases/workflowInit.ts` calls `crossCheckRepoIdentity` and writes `repoIdentity` to state. Tested by `adws/core/__tests__/repoIdentityCrossCheck.test.ts` and `launchGitContext.test.ts`.

## More Information

The PRD asked for a standalone package. It was first `adws/gitContext/` and is now `@paysdoc/devplatform/git`; see ADR-0051 ([0051-forge-agnostic-core-and-devplatform-dependency.md](0051-forge-agnostic-core-and-devplatform-dependency.md)), which also moves issue, pull request, label and board operations off `GitContext` onto the ports of ADR-0011 ([0011-provider-ports-and-immutable-repo-context.md](0011-provider-ports-and-immutable-repo-context.md)). The guard has since grown from one rule to three: shell-outs, cwd-derived identity and unsanctioned construction.

The PRD left out of scope: coordination across hosts (ADR-0035, [0035-single-host-per-repo.md](0035-single-host-per-repo.md)), how App tokens are minted (ADR-0016, [0016-github-app-identity.md](0016-github-app-identity.md)), and the cron crash hardening.
