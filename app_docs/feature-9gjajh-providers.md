# Providers — Multi-Platform Abstraction Layer

## Overview

The providers module defines platform-agnostic interfaces for issue tracking, code hosting, and project board management, and supplies the `RepoContext` factory that assembles them into a single immutable context object. It replaces the mutable global singleton that previously lived in `targetRepoRegistry.ts`, enforcing validated, frozen context at every workflow entry point.

## Responsibilities

- Define the `IssueTracker`, `CodeHost`, and `BoardManager` interfaces that all workflow phases program against.
- Define `RepoIdentifier`, `Issue`, `PullRequest`, `ReviewComment`, `IssueSummary`, `PullRequestSummary`, `ForgeActionResult`, and related platform-agnostic data types.
- Expose the `Platform` enum (`github`, `gitlab`, `bitbucket`) and `BoardStatus` enum with the canonical five-column set.
- Parse provider configuration from `.adw/providers.md` (`## Code Host`, `## Issue Tracker`, and optional URL / project-key sections).
- Validate the working directory (must exist, be a directory, contain `.git`) and verify the `origin` remote matches the declared `RepoIdentifier` before constructing context.
- Resolve concrete provider implementations (GitHub, GitLab, Jira) based on the configured platforms.
- Return a `Readonly<RepoContext>` frozen with `Object.freeze`.
- Export GitHub-specific implementations (`createGitHubIssueTracker`, `createGitHubCodeHost`, `createGitHubBoardManager`) and GitLab code host.
- Cover the full set of forge operations orchestrators and phases need — labels (two error policies), issue creation/body edit, open-issue search, PR-by-branch lookup, approval read/write, merge, and repo secret — so callers never need to reach past the provider triple for a forge-semantic operation.

## Contracts & Invariants

- `createRepoContext` always validates the repo identifier, working directory, and git remote before resolving providers; it throws on any mismatch.
- The returned `RepoContext` is immutable (`Object.freeze`); workflow phases must not mutate it.
- `BoardManager` is optional on the context; platforms without board support simply leave `boardManager` undefined rather than throwing.
- Provider platform resolution falls back to `.adw/providers.md` when neither explicit options nor a `ProvidersConfig` object is supplied; GitHub is the default for both code host and issue tracker when the file is absent.
- Remote URL parsing supports both HTTPS and SSH URL formats, using a case-insensitive owner/repo comparison.
- `BOARD_COLUMNS` is a frozen constant defining the five canonical ADW board columns in display order; column colors and descriptions can only be set at creation time (GitHub API limitation).
- `IssueTracker.addLabel` and `IssueTracker.applyLabel` are deliberately separate methods, not one collapsed method: `addLabel` logs and swallows any error (fail-open, used where a caller like auto-merge must proceed regardless), `applyLabel` lazy-creates a missing label and rethrows anything else. Picking the wrong one silently changes failure behaviour in failure-cap escalation and auto-merge gating paths.
- `IssueTracker.fetchComments` throws on a malformed response; callers that need `[]` on failure (e.g. `adwUpgrade`'s failure-cap counter) must wrap the call in their own `try/catch` — the port does not swallow this for them.
- `IssueTracker.findOpenUpgradeIssue` keeps its ADW-domain name rather than being expressed as a generic label/search query — the ports are forge-neutral, not domain-neutral (`moveToStatus(BoardStatus)` already encodes ADW's board vocabulary), and doing otherwise would change the emitted command string for no benefit.
- Every GitHub adapter method for these operations delegates to an existing `adws/github/*` function rather than reimplementing it, so the emitted `gh` command strings, error policy, and log lines are unchanged from calling that function directly — delegation is what makes provider migration behaviour-preserving.
- `GitLabCodeHost` and `JiraIssueTracker` implement every port method but refuse (throw, naming the method) any operation with no GitLab/Jira capability yet; this keeps the interfaces total without expanding either adapter's real capability.

## Configuration

Provider platforms are read from `.adw/providers.md` in the working directory. Supported sections: `## Code Host`, `## Issue Tracker`, `## Code Host URL`, `## Issue Tracker URL`, `## Issue Tracker Project Key`. All sections are optional; GitHub is the default. Platforms can also be passed explicitly via `RepoContextOptions.codeHostPlatform` / `issueTrackerPlatform`, or via a `ProvidersConfig` object injected by the project config layer.

## Gotchas

- `BoardManager` resolution errors are silently swallowed at construction time; callers that need board support must check for `undefined` before calling board methods.
- The git remote validation compares against `origin` only; repositories with non-standard remote names will always fail.
- Platform string parsing is case-insensitive but must exactly match one of the `Platform` enum values (`github`, `gitlab`, `bitbucket`); any other string throws.
- `dataTypes.ts` in `adws/types/` is a re-export barrel that delegates to `issueTypes.ts`, `issueRouting.ts`, `agentTypes.ts`, and `workflowTypes.ts`; it is kept only for backward compatibility.
