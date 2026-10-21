# PRD: GitContext — a single repo-context authority for all git and gh I/O

*Status: Draft — 2026-06-19*

## Problem Statement

ADW runs against many repositories from a single host: its own framework repo (self-hosted/dogfooding) and an arbitrary number of *target* repositories, each cloned under a target-repos directory and operated on through per-issue git worktrees. Every component that does anything with git or `gh` must answer two questions correctly: **"which repo's filesystem am I operating on?"** (the base path under which `.worktrees/` live, and the `cwd` for git commands) and **"which repo am I authenticated against?"** (the `gh`/GitHub-App token).

Today both answers are derived ad hoc at each call site, with unsafe defaults:

- The worktree base path is computed by a helper whose base-path parameter is **optional and silently defaults to the framework repo's working directory**. Any caller that forgets to pass the target base resolves worktrees under the *wrong* repo. Because the framework dogfoods itself, the default is *correct* in the most-exercised path and only detonates against target repos — so the bug ships and then fails in production.
- The GitHub token is applied by **mutating a process-global environment variable**, gated by a module-global "currently-authed repo." Concurrent, interleaved multi-repo work (notably the long-lived webhook server) overwrites that global mid-flight, authenticating calls against the wrong repository.

This is not one bug; it is a recurring **class** of bug. Mining the history surfaces ~13 distinct fix episodes over four months — wrong-repo worktree discovery, wrong PR-review target, `cwd` corrections, "thread the base path through these callers," process-global token bleed — each a point-fix against the same underlying ambiguity. A prior centralization attempt (extracting branch-name assembly and threading an optional base-path parameter through *some* callers) did not hold: it centralized the *computation* while leaving an optional defaulting parameter reachable, never made the authoritative identity mandatory or durable, and a newer call site (orchestrator takeover) re-introduced the exact same defect, stranding a real production issue in an unrecoverable retry loop.

From the operator's perspective: workflows mysteriously fail or stall against target repos, `gh` calls intermittently report "could not resolve to a repository," and every fix is followed weeks later by another instance of the same shape somewhere new.

## Solution

Introduce a single **repo-context authority** — a `GitContext` — that owns **every** git and `gh` interaction in ADW, shipped as a **standalone, reusable package** so future projects can adopt the same mechanism.

A `GitContext` is constructed exactly once, at each process's **launch boundary**, from that boundary's already-authoritative identity (the `--target-repo` CLI arguments for cron and orchestrators; the event payload for the webhook). It bakes in:

- the **repo identity** (`owner/repo`) used for all `gh` operations,
- the **filesystem base path**, resolved in one place (self-host → the framework repo root; target → the target-repos workspace for that owner/repo),
- the **auth token and git author identity**, applied **per command** via the spawned process's environment — never by mutating the parent process's global environment.

Every git and `gh` operation becomes a method on the context. The package exposes **no context-free way** to run git or `gh`. A CI/lint guard fails the build if any code outside the package shells out to `git` or `gh` directly. The wrong path stops being *discouraged* and becomes *unrepresentable*.

Because identity is always available at the launch boundary, the context is constructed there and threaded down; it is also **persisted into workflow state as a cross-check**, but the launch boundary — not persisted state — is the source of truth. This makes bootstrapping trivial and makes migrating existing in-flight workflows a non-event: a process resuming an old workflow uses its own launch identity, so old state lacking the identity field is irrelevant.

The result: worktree/`cwd` resolution can no longer default to the wrong repo, and two contexts for two repos in the same process can no longer clobber each other's auth.

## User Stories

1. As an ADW operator, I want every workflow to operate on the correct target repository's worktrees, so that runs against target repos stop silently failing under the framework repo's directory.
2. As an ADW operator, I want concurrent multi-repo activity to never authenticate against the wrong repository, so that `gh` calls stop intermittently failing with "could not resolve to a repository."
3. As an ADW operator, I want a workflow that died before pushing to be recoverable, so that a transient agent failure does not strand an issue in a permanent retry loop.
4. As an ADW maintainer, I want a single place that decides "which repo's filesystem and which auth," so that I can reason about and fix repo-scoping in one module instead of dozens of call sites.
5. As an ADW maintainer, I want it to be impossible to call git or `gh` without supplying a repo context, so that a new call site cannot reintroduce the wrong-repo class of bug.
6. As an ADW maintainer, I want the base-path decision (self-host vs target) to live in exactly one constructor, so that no call site ever re-derives it from ambient state.
7. As an ADW maintainer, I want auth applied per command rather than via a process-global, so that interleaved async work in a long-lived process cannot bleed tokens between repos.
8. As an ADW maintainer, I want the build to fail when someone shells out to git or `gh` directly, so that the guarantee is enforced mechanically rather than by convention.
9. As an orchestrator process, I want to construct a context from my launch arguments at startup, so that all my phases inherit the correct repo scoping without re-deriving it.
10. As a takeover/cron process, I want to act on an abandoned workflow using my own authoritative target identity, so that I never fall back to the framework repo's working directory.
11. As a merge orchestrator, I want to resolve and merge the PR against the correct repository, so that standalone merge handoffs target the right repo.
12. As the webhook server, I want to construct a per-event context from the event payload, so that handling events for multiple repos in one process cannot cross-contaminate auth or paths.
13. As a workflow, I want my repo identity persisted into my state, so that tooling and audits can see which repo a run belonged to.
14. As a resuming process, I want persisted identity to act as a cross-check against my launch identity, so that a mismatch can be detected rather than silently producing wrong results.
15. As an ADW maintainer, I want existing in-flight workflows to keep working after the change without a backfill migration, so that the cutover is safe.
16. As an ADW maintainer, I want all worktree operations (create, remove, reset, list, path lookup) to go through the context, so that worktree resolution is consistent everywhere.
17. As an ADW maintainer, I want all branch and commit/push operations to go through the context, so that git identity and `cwd` are always correct.
18. As an ADW maintainer, I want all issue/PR/comment operations to go through the context, so that the `gh` target repo is never ambiguous.
19. As a future project owner, I want to import the git package and get the same guarantees, so that I do not re-implement repo scoping from scratch.
20. As an ADW maintainer, I want the context to be a deep module with a simple interface, so that the large amount of git/auth/cwd complexity is hidden behind a stable surface that rarely changes.
21. As an ADW operator, I want self-hosted runs (ADW operating on its own repo) to resolve to the framework repo root, so that dogfooding continues to work unchanged.
22. As an ADW operator, I want target runs to resolve to the target-repos workspace, so that target worktrees are created and found in the right place.
23. As an ADW maintainer, I want a clear failure when a context is constructed with incomplete identity, so that misconfiguration surfaces immediately instead of defaulting to the wrong repo.

## Implementation Decisions

**New standalone package — the `GitContext` deep module.**
- A new package encapsulates all git and `gh` interaction. It is dependency-injectable and importable by other projects. Its public interface is the `GitContext` plus a single constructor; it exposes no free functions that perform git/`gh` without a context.
- The constructor takes an explicit identity: `owner`, `repo`, a self-host flag (or equivalent discriminator), the auth token, and the git author/committer identity. There is **no optional base path and no `cwd` fallback**. Incomplete identity is a hard construction error.
- Base-path resolution lives **only** in the constructor: self-host resolves to the framework repo root; target resolves to the target-repos workspace for that `owner/repo`. No other code computes a base path.
- Every operation is a method that spawns its underlying git/`gh` command with an explicit `cwd` (base path or the relevant worktree path) and an explicit child-process environment carrying the token and git identity. The parent process's global environment is **never** mutated for auth.
- Operation surface (methods, not free functions): worktree create/remove/reset/list and worktree-path lookup; branch create/checkout/delete/default-branch; commit and push; fetch/reset-to-remote; issue read/comment, PR read/create/merge/review, label and project-board operations. Existing modules that perform these become thin adapters over the context or are absorbed into the package.

**Boundary constructors (thin adapters).**
- Each process entry point constructs exactly one context at startup from its launch identity: cron and standalone orchestrators from parsed `--target-repo` arguments (falling back to the local git remote for self-host); the webhook from the event payload's repository, constructed **per event**.
- The context is threaded from the entry point through phases and agents. Nothing downstream reconstructs it from ambient `cwd`.

**Identity persistence (cross-check, not source of truth).**
- The top-level workflow state schema is extended to carry the repo identity (`owner/repo`), written at workflow initialization.
- The launch boundary remains authoritative. Persisted identity is read as a cross-check; a divergence between persisted identity and launch identity is treated as a detectable error rather than silently resolved.
- No backfill migration is required: processes resuming pre-change workflows use their own launch identity, so the absence of the persisted field on old state is harmless.

**Auth model.**
- The token (GitHub-App installation token or PAT) and git author/committer identity are carried on the context and injected into each spawned command's environment. The legacy process-global token mutation and module-global "currently-authed repo" are removed from the hot path; concurrent contexts are mutually isolated by construction.

**Enforcement.**
- A CI/lint guard fails the build on any direct `exec`/`spawn` of `git` or `gh` outside the package. This is the mechanism that turns "route through the context" from convention into an invariant. (Shipped as a CI rule; no unit tests requested for the guard itself.)

**Removal of the unsafe primitives.**
- The optional, defaulting base-path helper and any direct `cwd`-defaulting worktree-path computation are eliminated in favour of context methods, so the previously-reachable wrong path no longer exists.

## Testing Decisions

Good tests here assert **external, observable behaviour** — the `cwd` and environment a context actually runs commands with, and the base path it resolves for a given identity — not internal call structure. They must demonstrate the two properties that every past incident violated: correct base-path selection per identity, and per-command auth isolation with no global mutation.

Modules to be tested (per the developer's selection):

1. **GitContext core (highest value).**
   - Base-path resolution: a self-host identity resolves to the framework repo root; a target identity resolves to the target-repos workspace for that `owner/repo`; constructing with incomplete identity fails loudly.
   - Per-command auth/env injection: operations run with the expected token and git-author environment supplied to the child process, and the parent process's global environment is left unmutated.
   - Isolation: two contexts for two different repos, exercised in the same process, never observe each other's `cwd` or token (the bleed is structurally impossible).
   - Worktree-path correctness: the worktree path for a branch is computed under the context's base path, not the ambient working directory.

2. **Identity persistence.**
   - Round-trip: identity written to top-level state at initialization is read back intact; a resumer prefers its launch identity and treats persisted identity as a cross-check; a mismatch is surfaced rather than silently resolved.

3. **Boundary constructors.**
   - cron / orchestrator: a context built from `--target-repo` arguments resolves to the target workspace; absent target arguments, self-host resolves to the framework repo root.
   - webhook: a context built from an event payload's repository resolves to that repository, independent of any other in-flight event.

Prior art to mirror: the existing worktree-reset unit tests (deterministic git-operation behaviour against a temp repo), the repo-context provider tests (construction-from-identity), and the GitHub API/test-harness suites (operation behaviour without hitting the network).

The enforcement guard ships as a CI/lint rule and was explicitly not selected for unit testing.

## Out of Scope

- Cross-host coordination. The single-host constraint is unchanged; this PRD does not introduce distributed locking or multi-host repo coordination.
- A separate git **service/daemon process**. This was considered and rejected: the only thing a process boundary uniquely bought was isolation of the process-global token, which per-command environment injection achieves in-process, while a daemon would add IPC failure modes and a macOS process-lifecycle problem (no `PR_SET_PDEATHSIG`, requiring a re-implementation of PID-liveness/heartbeat).
- The tactical cron-crash hardening — per-candidate `try/catch` in the cron loop and Slack notification on crash/abandon — is related but tracked separately; it mitigates *symptoms* of this class and is not part of this structural fix.
- A backfill migration of existing state files. Deliberately unnecessary under the launch-boundary-as-source-of-truth design.
- Changing the auth *acquisition* (how App installation tokens are minted/refreshed); only how they are *applied* (per-command vs process-global) changes.
- Provider abstractions beyond GitHub (GitLab/Jira) are not re-architected here, though the context interface should not preclude them.

## Further Notes

- **Why this is different from the prior centralization that regressed.** The earlier attempt centralized the worktree-path *function* but left an optional base-path parameter with a wrong default, never made identity mandatory or durable, and relied on convention to route calls. This PRD makes the wrong path *unrepresentable* (no context-free git/`gh` in the package), makes identity *mandatory* (no optional base, no `cwd` fallback), resolves the one "which base" decision in a single constructor, and enforces routing mechanically via CI. "Mandatory" is paired with "correct": the mandatory context is always sourced from the authoritative launch boundary, never re-derived from ambient `cwd`.
- **The deep-module bet.** `GitContext` is intentionally a deep module: it hides a large amount of functionality (git, `gh`, worktrees, `cwd`, auth, base-path resolution) behind a small, stable interface (an identity in, operations out). The interface should rarely change even as the internals evolve.
- **Reuse.** Shipping as a standalone package is a first-class goal, so the package must not depend on ADW-specific globals; identity and configuration are injected at construction.
- **Live confirmation of the model.** During design, an orchestrator's own initialization was observed to robustly recreate a missing worktree at the correct target base, while the cron's takeover path computed the same worktree under the wrong base — two code paths resolving the same thing, one right, one wrong. Collapsing all such resolution into the single context authority is the fix.
