---
status: accepted
date: 2026-03-17
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: commit 8c92fc94 (2026-03-17)
  - kind: contemporaneous
    source: specs/issue-184-adw-3yayf1-cron-pr-polling-re-t-sdlc_planner-fix-self-review-filter.md
  - kind: contemporaneous
    source: specs/issue-258-adw-fvzdz7-auto-approve-and-mer-sdlc_planner-auto-approve-merge-after-review.md
  - kind: recalled
    source: "Martin Koster, 2026-09-29"
supersedes: []
superseded-by: []
---

# ADW acts on GitHub as a GitHub App, not as the owner

## Context and Problem Statement

ADW posted comments, opened pull requests and submitted reviews through the `gh` CLI, authenticated as the owner's personal account. GitHub therefore recorded ADW's actions and the owner's actions under one user.

Issue #184 (2026-03-16) shows the cost. The cron trigger excluded non-human comments by `user.type === 'Bot'`. ADW's own reviews carried `user.type === 'User'`, passed the filter as human feedback, and started `adwPrReview` again on every cron cycle. The fix for #184 filtered on the authenticated user name and on ADW's comment signature. Commit 8c92fc94 added GitHub App authentication the next day.

## Decision Drivers

* Separate ADW's actions from the owner's, so that ADW can tell its own comments and pull requests from human ones (recalled).
* GitHub forbids approving your own pull request. A pull request authored by the App can be approved by a different identity (recalled).

## Considered Options

None recorded.

## Decision Outcome

ADW authenticates as a GitHub App when `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY_PATH` are set. It signs a JWT with the App's private key and exchanges it for a short-lived installation token. The installation is resolved per `owner/repo` through the GitHub API, so nothing is configured per organisation.

The App is optional. Without it the token resolves to `GITHUB_PAT`, then to `gh auth token`.

Approval uses the owner's identity, not the App's. #258 defined this: when the App is configured, `gh pr review --approve` runs under the personal identity, "a different user from the bot author"; when it is not, approval is skipped.

### Consequences

* Good, because ADW's comments and pull requests appear under the App, and `isBot` separates them from human input.
* Good, because a pipeline pull request can be approved without a second human account.
* Bad, because two credentials are needed. With the App configured, `GITHUB_PAT` is mandatory and a workflow stops at start-up without it.
* Bad, because installation tokens expire. A token read once at launch goes stale in a long run, so credentials have to be resolved per command.
* Bad, because the first implementation applied the token by setting `GH_TOKEN` in `process.env`. That process-global value later leaked between repositories in the webhook server and was removed by ADR-0046.

### Confirmation

Checked on 2026-09-29:

* `adws/core/githubAppAuth.ts` is the one file that reads the three `GITHUB_APP_*` variables. `launchCredentialsOptions` in `adws/core/launchGitContext.ts` passes them, `GITHUB_PAT` and `alternateIdentityPat` to the library's `createForgeCredentials`. The token mint itself is in `@paysdoc/devplatform`.
* `adws/phases/workflowInit.ts` throws "GitHub App is configured but GITHUB_PAT is not set" when the PAT is missing.
* `adws/core/unaddressedComments.ts` excludes comments with `isBot` and comments by the authenticated user.
* `gh pr list --state merged --limit 8` shows pipeline pull requests #914 to #920 authored by `app/paysdoc-adw` with `is_bot: true`.
* Unit tests: `adws/core/__tests__/githubAppAuth.test.ts`, `launchGitContext.test.ts`, `forgeWiring.test.ts`.

Not checked: the App's permissions and installations on GitHub, and the host's environment file.

## More Information

The approval identity is used by the review phase and by the chore orchestrator; the merge flow is ADR-0028 ([0028-orchestrators-stop-at-awaiting-merge.md](0028-orchestrators-stop-at-awaiting-merge.md)) and ADR-0038 ([0038-stateless-merge-gate.md](0038-stateless-merge-gate.md)). Per-command credentials are ADR-0046 ([0046-gitcontext-as-sole-git-authority.md](0046-gitcontext-as-sole-git-authority.md)). The move of the token mint into the library is ADR-0051 ([0051-forge-agnostic-core-and-devplatform-dependency.md](0051-forge-agnostic-core-and-devplatform-dependency.md)).

The rationale in Decision Drivers is recalled; commit 8c92fc94 has no message body, and its only recorded reason is the line added to `.env.sample`: "comments appear as the app, not your personal account".

Unresolved: not every pipeline commit carries the App's identity. Of the non-merge commits on `origin/dev` since 2026-09-01, 108 are authored by `paysdoc-adw[bot]` and 53 by `Martin <martin@macmini.local>`; the latter carry agent prefixes such as `build-agent:` and `plan-orchestrator:` (for example 50e8a702, 2026-09-25). The cause was not determined, and no source says whether commit authorship is part of this decision.
