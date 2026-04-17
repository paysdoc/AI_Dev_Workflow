# depaudit — Dependency Audit Gate

## Problem Statement

As a maintainer of ADW-managed (and non-ADW) repositories, I want continuous confidence that my dependency tree is free of medium-or-higher severity risks before any code reaches production. Today I can run `bun install` or `npm audit` ad-hoc, but:

- I have no stable gate that forces the check before a merge into the production branch.
- I have no way to consciously accept a known risk with a deadline that forces periodic re-review.
- I have no coverage of supply-chain risk signals (maintainer churn, typosquatting, install-time code execution, suspicious postinstall scripts) — only published CVEs.
- I have no uniform process across my polyglot repositories (Node, Python, Go, etc.).
- I have no low-friction way to be told, as the maintainer, when a previously-accepted risk expires and needs re-evaluation.

The consequence is implicit risk accumulation: vulnerabilities and supply-chain threats live in the tree until someone notices — which is usually "when something breaks."

## Solution

A standalone, polyglot CLI called **`depaudit`** that scans every dependency manifest in a repository, identifies both CVEs (via OSV.dev) and supply-chain risks (via Socket.dev), classifies findings against a committed, time-limited acceptance list, and fails the CI gate if new or expired findings are present.

Acceptance is a first-class concept: every accepted risk has an in-repo, git-reviewable entry with a required reason, an expiry date (max 90 days), and optionally a link to an upstream issue filed on the offending dependency's own repository. When accepts expire, the gate flips back to failing and forces the maintainer to re-evaluate — ensuring no risk quietly lives forever.

An ADW-only Claude Code skill, **`/depaudit-triage`**, walks a maintainer through each finding interactively: upgrade the direct parent, accept with a reason, file an upstream issue, or skip. Power users and future UI clients can edit the config files directly.

## User Stories

1. As a maintainer, I want a CI check that fails any merge into my production branch if new vulnerabilities at or above my configured severity threshold (default `medium`) exist in my dependency tree, so that production never receives code with unknown vulnerabilities.

2. As a maintainer, I want the same gate to run whether my production branch is `main` or I follow a `dev` → `main` release model, so that my branching style doesn't dictate my security posture.

3. As a maintainer, I want supply-chain signals (maintainer churn, typosquatting, suspicious install scripts) surfaced alongside published CVEs, so that I catch threats that don't yet have a CVSS score.

4. As a maintainer, I want to consciously accept a known risk for a bounded period with a written justification, so that legitimate tradeoffs are documented and revisited, not quietly ignored.

5. As a maintainer, I want accepted risks to expire after at most 90 days, so that no risk silently outlives its original justification.

6. As a maintainer, I want acceptance entries to live in my repository as git-tracked files, so that acceptances appear in diffs, PRs, and `git blame` like any other decision.

7. As a maintainer, I want the gate to reject hand-written acceptance entries that lack a reason or have expiries further than 90 days out, so that the system cannot be subverted by pasting in a multi-year expiry.

8. As a contributor, I want the PR gate to tell me exactly which package, version, and finding introduced the failure, plus a suggested action, so that I can resolve the finding without digging through CI logs.

9. As a contributor, I want the PR gate to update a single comment on my PR (not post a new one each time I push), so that my PR stays readable as I iterate.

10. As a maintainer, I want a low-volume Slack notification the first time a given PR fails the gate, so that I can intervene on expired-accept flips I'm expected to handle myself, without being spammed on contributor-driven churn.

11. As a maintainer of a repository that I manage through ADW, I want `adw_init` to automatically set up depaudit during target repo onboarding (scaffolding config, registering secrets, baselining the current tree), so that a new ADW-registered repo is secured without manual steps.

12. As a maintainer, I want `depaudit setup` to baseline every currently-open finding as an auto-accepted entry at install time, so that my first PR after installation doesn't fail on decades of pre-existing debt.

13. As a maintainer, I want every baselined entry to have a 90-day expiry, so that within a quarter I'm forced to actually look at the existing debt.

14. As a maintainer, I want `depaudit setup` to commit to my current branch when I'm on a feature branch, but open a PR when I invoke it on the production branch itself, so that the setup step doesn't bypass the gate it's installing.

15. As a maintainer, I want a polyglot scanner that discovers `package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`, `pyproject.toml`, `pom.xml`, `Gemfile`, `composer.json` automatically, so that I don't have to declare manifests explicitly for a monorepo.

16. As a maintainer of a monorepo with multiple manifests, I want findings from all manifests merged into one scan and one PR comment, so that I have a single gate rather than many.

17. As a maintainer using a package that legitimately has install scripts (TypeScript, esbuild, tsx, Prisma, Playwright), I want to whitelist a `(package, alert-type)` combination once so it stops flagging on every scan, with that whitelist also being time-bounded at 365 days for periodic sanity review.

18. As a maintainer, I want the Socket supply-chain layer to fail open (skip that check, keep CVE-based gating) rather than fail closed, so that a Socket outage doesn't block every contributor's PR.

19. As a developer at triage time, I want an interactive Claude Code skill that walks me through each finding sequentially, offering concrete actions (upgrade parent, accept, file upstream, skip), so that I don't have to mentally context-switch between a CI log and YAML files.

20. As a developer, I want the triage skill to recognize when a parent-upgrade requires a major-version bump and pause for my confirmation, so that I don't accidentally introduce breaking changes.

21. As a developer, I want the triage skill to auto-file an issue on the offending dependency's own repository when I choose "file upstream," so that the dep's maintainers know about the problem and ADW-registered dep repos auto-process the fix.

22. As a developer, I want the triage skill to record the upstream issue URL in the accept entry, so that future reviewers of the register can see what action has already been taken.

23. As a developer, I want the triage skill to leave the findings file as a static snapshot (no auto re-scan after each action), so that walking through a long list doesn't stall on repeated network round-trips.

24. As a power user, I want to edit `.depaudit.yml` and `osv-scanner.toml` directly without going through the skill or CLI, so that routine edits don't force me into an interactive flow.

25. As a future non-technical user, I want the entire triage flow to be usable through a UI wrapper without ever opening a file, so that less-technical team members can participate in risk decisions.

26. As a maintainer, I want all cost to remain low — free CLI tools, Socket.dev free tier, no commercial vendor lock-in — so that this check doesn't become a budget line item.

27. As a maintainer, I want the tool to work today on repositories I already own without requiring an organization-wide migration, so that I can adopt it incrementally per repo.

28. As a maintainer of multiple ADW-managed repos, I want all my Slack notifications to flow through a single channel (sourced from ADW's `.env`), so that I don't receive the same notification across many repo integrations.

29. As a maintainer, I want `depaudit lint` to be a standalone command I can wire into a pre-commit hook, so that bad register edits are caught before they're pushed.

30. As a security-conscious maintainer, I want the strict `(package, version, finding-ID)` identity model for acceptance entries, so that a version bump forces re-review rather than silently carrying forward a multi-year-old acceptance.

31. As a developer submitting a PR that introduces a new dependency, I want the gate's PR comment to suggest a remediation for each new finding (e.g., "upgrade ajv to ≥8.17.1"), so that I have a concrete next step rather than just a negative verdict.

32. As a maintainer, I want GitHub Code Scanning (SARIF) explicitly *not* populated by this tool, so that the in-repo register remains the single source of truth for accepted risks and I don't have two UIs to reconcile.

33. As a maintainer, I want to configure the severity threshold per repository (`medium`, `high`, or `critical`, defaulting to `medium`), so that I can apply stricter gating to high-risk repositories (production services, compliance-sensitive codebases) and a looser threshold where the cost of a blocked PR outweighs the risk of a low-severity finding.

34. As a developer triaging a finding that requires a major-version upgrade of a direct parent, I want the skill to refuse to apply the bump directly and instead file a tracked issue on the repository, so that breaking changes aren't silently introduced by an automated flow and the work is visible to the team.

35. As a maintainer of an ADW-registered repository, I want the auto-filed major-bump issue to include `/adw_sdlc` in its body, so that ADW immediately picks up the issue and runs the full SDLC to produce the upgrade PR without further manual intervention.

36. As a maintainer, I want the skill to simultaneously write a short-lived accept entry (default 30 days, user-adjustable up to the 90-day cap) when it files a major-bump issue, so that the gate doesn't freeze unrelated PRs from merging while the upgrade work is in flight.

37. As a maintainer, I want the auto-filed issue to use a stable, greppable title format (`depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`), so that I can discover all pending major-bump work with a simple search.

38. As a developer, once an upgrade PR lands and the corresponding finding disappears from my tree, I want `depaudit scan` to automatically prune the now-orphaned accept entry from the config file, so that I don't have to open a cleanup PR just to delete stale YAML.

39. As a maintainer, I want `depaudit scan` to NOT auto-prune accept entries when the corresponding finding source (OSV or Socket) was unavailable during the scan, so that a transient outage doesn't erase legitimate acceptances.

## Implementation Decisions

### Stack & Architecture

- **CLI distribution**: `depaudit` is a Node/Bun CLI published to npm. `npm install -g depaudit` works on any runner with Node installed.
- **Findings sources**: Two. OSV-Scanner (Go binary invoked as a subprocess) for CVE coverage across all supported ecosystems; Socket.dev REST API for supply-chain signals where Socket has coverage (npm, PyPI, and a subset of others). Trivy is deliberately *not* used — OSV-Scanner's native `IgnoredVulns` with `ignoreUntil` already provides the expiring-allowlist behavior and Trivy would duplicate CVE findings.
- **Graceful degradation**: For ecosystems that Socket doesn't cover (e.g., Cargo, Maven in some configurations), the scan still produces CVE findings via OSV; the supply-chain section is simply absent for those packages.
- **Socket failure mode**: Fail open. A Socket API error (timeout, 5xx, rate-limit) causes depaudit to skip supply-chain findings for that run and annotate the PR comment with "supply-chain unavailable." OSV-based CVE gating continues normally.

### In-repo artifacts (per target repo)

- **`osv-scanner.toml`** — OSV-Scanner's native config. Owns CVE acceptance entries (`[[IgnoredVulns]]`). File name is mandated by OSV-Scanner and cannot be renamed.
- **`.depaudit.yml`** — depaudit's master config. Contains:
  - `version` — schema version (starts at `1`; future bumps require explicit migration).
  - `policy` — `severityThreshold` (configurable per repo; one of `medium`, `high`, or `critical`; defaults to `medium`), `ecosystems` (`auto` or explicit list), `maxAcceptDays` (90), `maxCommonAndFineDays` (365).
  - `commonAndFine` — category-wide whitelist of `(package, alertType)` pairs that are expected and should not flag; each entry has a 365-day max expiry.
  - `supplyChainAccepts` — per-finding acceptance entries keyed by `(package, version, alertType)`, with `reason` (≥20 chars), `expires` (≤90 days from today), and optional `upstreamIssue` URL.
- **`.github/workflows/depaudit-gate.yml`** — CI workflow scaffolded by `DepauditSetupCommand`. Pinned to the resolved trigger branch (`main` if the branch exists in the repo, else the repo's default branch). Installs depaudit via `npm install -g`, runs `depaudit scan`, posts/updates the PR comment, fires Slack on first-failure transition.
- **`.depaudit/findings.json`** — gitignored artifact written by every `depaudit scan` run, consumed by the `/depaudit-triage` skill.

### Finding identity

Strict `(package, version, finding-ID)` for both CVEs and supply-chain signals. A version bump invalidates any existing acceptance — the user must re-evaluate whether the risk still applies. `finding-ID` is the CVE-ID or GHSA-ID for CVEs, or the Socket alert-type identifier for supply-chain signals.

### Linter rules (enforced on every scan and as standalone `depaudit lint`)

1. YAML/TOML parse errors halt with line/column.
2. Required fields must be present; types must match the schema.
3. `expires` must be ≤ today + relevant cap (90 days for supply-chain accepts and OSV `IgnoredVulns`; 365 days for `commonAndFine`).
4. `expires` must not be in the past.
5. `reason` on acceptances must be ≥20 characters; `commonAndFine` reason is optional.
6. Enum fields (`severityThreshold`, `ecosystems`) must match the allowed set.
7. Duplicate entries (same `(package, version, finding-ID)` twice) produce a warning, not a fatal.
8. Schema `version` mismatch halts with migration guidance (no auto-migration).

### Gate semantics

A scan passes if:
- No current finding above the severity threshold is un-accepted.
- No accept entry that still matches a current finding has an expired `expires` date.
- The lint step passes (orphaned entries produce warnings only, not failures — see auto-prune below).

Otherwise it fails. "Accepted" means the finding matches an entry in `supplyChainAccepts` (supply-chain), `[[IgnoredVulns]]` (CVE), or falls under a `commonAndFine` category rule. Any ambiguity resolves against the user.

### Auto-prune of orphaned accept entries

After an upgrade PR lands, the finding disappears from the tree but its accept entry remains. Such entries are *orphaned* (no current finding matches them). `depaudit scan` detects orphans and removes them from the appropriate file (`.depaudit.yml` or `osv-scanner.toml`) in place — this is the only mutation `scan` performs on committed files. When running under CI the mutation is ephemeral (no automated commit); running locally leaves the cleanup in the developer's working tree for them to commit (or ignore, since the next scan is idempotent).

**Fail-open guard:** the auto-prune step must NOT remove entries belonging to a finding source that was unavailable during the current run. If Socket failed (we went fail-open), supply-chain accepts are considered un-knowable this run and are left untouched. Pruning only applies to entries whose source produced a clean classification.

### Bootstrap (`DepauditSetupCommand` / `depaudit setup`)

1. Detect ecosystems by discovering manifests across the repo (respecting `.gitignore`).
2. Resolve the trigger branch: `main` if present in the remote, else the repo's default branch.
3. Scaffold `.github/workflows/depaudit-gate.yml` pinned to the resolved branch.
4. Scaffold an empty `osv-scanner.toml` with a documentation header.
5. Scaffold `.depaudit.yml` with the detected ecosystems, default policy, and empty `commonAndFine` / `supplyChainAccepts`.
6. Append `.depaudit/findings.json` to `.gitignore`.
7. Run the first scan.
8. Write every finding at or above the configured severity threshold as an accepted entry with `reason: "baselined at install"` and `expires: today + 90d`.
9. Set `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` as repository secrets via `gh secret set` (reading values from environment; tokens surfaced by ADW's `.env` when invoked via `adw_init`).
10. Commit. If the current branch is *not* the repo's production branch, commit directly. If the current branch *is* the production branch, create a `depaudit-setup` branch, push, open a PR, and leave it for normal review. This prevents the setup from bypassing the gate it installs.

### Remediation policy (encoded in the skill, documented for power users)

Allowed remediations, in order of preference:

1. **Minor or patch upgrade of the direct parent.** The skill applies this autonomously without human confirmation during triage. Minor/patch bumps are expected to preserve the parent's API contract.
2. **Major upgrade of the direct parent.** Major bumps may include breaking changes in the parent's API and therefore require a code-change cycle that's out of scope for the triage skill. The skill **must not apply a major bump directly**. Instead, when the only resolving upgrade path is a major bump, the skill files an issue on the current repository (title format: `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`) with `/adw_sdlc` embedded in the body. On ADW-registered repositories, ADW picks up the issue immediately and runs the full SDLC to produce the upgrade PR. The same action simultaneously writes a short-lived accept entry (default 30 days, user-adjustable up to the 90-day cap) with `upstreamIssue` pointing to the new issue, so the gate doesn't freeze unrelated PRs while the upgrade work is in flight.
3. **Accept the risk with a reason and an expiry (≤ 90 days).** Used when no fix is available upstream, when the finding is a known-unreachable edge case, or when the user wants to defer action.
4. **Accept the risk and file an upstream issue on the dependency's own repository.** The skill auto-files via `gh issue create --repo <dep-owner>/<dep-repo>`, records the URL in `upstreamIssue`, and writes the accept entry. Used when the fix must come from the dep's maintainers (e.g., the dep hasn't released a version that bumps a vulnerable transitive).
5. **Replace the direct parent entirely** with a different package. Reserved for urgent (high/critical) severity findings where no viable upgrade or accept path exists. Not automated; the skill surfaces this as a manual TODO and the user handles the replacement outside the triage session.

Explicitly *not* allowed:

- Adding `overrides` / `resolutions` in `package.json` to pin a transitive; the parent was never tested against that override.
- `--ignore-scripts` as a persistent install policy; breaks packages that legitimately need their build step.

### ADW Integration

- `adwInit.tsx` calls `depaudit setup` as a post-clone step for every ADW-managed target repo.
- `adwInit.tsx` propagates `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` from ADW's `.env` to each target repo's GitHub Actions secrets via `gh secret set`.
- `/depaudit-triage` lives in ADW's `.claude/skills/` with `target: false` (not copied into target repos; invoked from the ADW side or a future UI).
- Non-ADW target repos install and run `depaudit` manually; power users edit config files directly. The skill is not available on non-ADW repos.

### PR comment and Slack notification

- PR comment is identified by an HTML marker (`<!-- depaudit-gate-comment -->`) and updated in place on every scan. Pass and fail comments have distinct templates; expired-accept-driven failures are called out in a dedicated section.
- Slack fires exactly once per pass→fail state transition on a given PR. Payload is minimal text (`"depaudit-gate failed on PR #N: <link>"`). Delivery is a direct HTTPS POST to an Incoming Webhook; the webhook URL lives in the per-repo `SLACK_WEBHOOK_URL` secret populated by `adw_init`.
- SARIF / GitHub Code Scanning is deliberately *not* used. The in-repo register is the sole source of truth; SARIF would introduce a parallel dismiss-tracking mechanism in GitHub's UI.

### Modules (all deep except where noted)

- **`ManifestDiscoverer`** — walks the repo, honors `.gitignore`, returns a list of `(ecosystem, manifest path)` tuples.
- **`ConfigLoader`** — parses `.depaudit.yml` and `osv-scanner.toml` into typed, validated objects.
- **`Linter`** — pure function from parsed configs to a list of lint errors; enforces every rule above.
- **`OsvScannerAdapter`** — shells out to `osv-scanner`, parses its JSON output, normalizes into the internal `Finding` type.
- **`SocketApiClient`** — HTTP client for Socket.dev's API; handles auth, retry with backoff, fail-open on timeout, and normalization to `Finding`.
- **`FindingMatcher`** — pure function that classifies each `Finding` against `supplyChainAccepts`, `commonAndFine`, and OSV `IgnoredVulns`; output categories are `new`, `accepted`, `whitelisted`, `expired-accept`.
- **`StateTracker`** — tracks PR-level state across scan runs (for comment dedupe and first-failure Slack dedupe); operates on PR state (comment presence, prior scan outcome).
- **`CommitOrPrExecutor`** — encapsulates the hybrid "commit to current branch unless on production branch, else open a PR" policy used during `depaudit setup`.
- **`Reporter`** (composes **`MarkdownReporter`**, **`JsonReporter`**, **`SlackReporter`**) — formats classified findings into PR-comment markdown, `.depaudit/findings.json`, and Slack payloads respectively.
- **`ScanCommand`** (composition root, not deep) — wires the pipeline for `depaudit scan`.
- **`DepauditSetupCommand`** (composition root, not deep) — wires the pipeline for `depaudit setup`, including the commit/PR decision.

### Claude Code skill

`/depaudit-triage` lives in ADW's `.claude/skills/depaudit-triage/SKILL.md`. It:

- Locates `.depaudit/findings.json` in the current working directory.
- Walks findings one at a time, static snapshot (no auto re-scan; user manually skips any finding they know a prior action already resolved).
- Per finding, presents four actions: upgrade parent / accept+document / accept+file-upstream-issue / skip.
- For upgrades, the skill inspects the available resolving versions of the direct parent:
  - If a minor or patch bump resolves the finding, the skill applies it autonomously (edits the manifest, runs the package manager install, moves on).
  - If only a major bump resolves the finding, the skill **does not apply the bump**. It files a tracked issue on the *current* repository with title `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)` and body embedding `/adw_sdlc`. It simultaneously writes an accept entry pointing to the new issue via `upstreamIssue`, with a default 30-day expiry (the user can override up to the 90-day cap). On ADW-registered repos, ADW picks up the filed issue and runs the upgrade PR end-to-end.
- For accept actions, prompts for `reason` and `expires` (with max caps enforced) and writes the entry in canonical form into the correct file (`.depaudit.yml` for supply-chain, `osv-scanner.toml` for CVEs).
- For "file upstream issue," drafts a title and body, uses `gh issue create --repo <upstream>` to post to the dependency's own repo, and records the returned URL in the accept entry as `upstreamIssue`. Auto-filing is unconditional of whether the upstream is ADW-registered — the propagation behavior differs (registered upstreams self-drive a fix; unregistered ones treat it as a standard maintainer nudge) but both cases are acceptable outcomes.
- **Idempotency:** if a finding already has an accept entry with a non-empty `upstreamIssue` field, the skill recognizes it as already-in-progress and skips re-filing, presenting the finding as "in flight — issue #N" in the triage transcript.
- The skill does not file tracking issues for non-major-bump cases on the current repository. A tracking issue on an ADW-registered repo that merely says "re-check CVE-XXX later" would self-trigger ADW processing and resolve to the same accept, producing a loop. The 90-day accept expiry is the re-review reminder for those cases.

## Testing Decisions

### What makes a good test

- Tests cover **external behavior**, not internal implementation details: given a scenario, the test asserts what the module produces, not how.
- Deep modules with pure or state-machine interfaces get dedicated unit tests; composition roots are exercised via integration tests against fixture repositories.
- Snapshot tests are used for renderer output (`MarkdownReporter`, `JsonReporter`) because the exact formatting is part of the external contract.
- Mocks are used where a module wraps a subprocess or HTTP boundary; mocks simulate the boundary's responses, not the module's own logic.

### Modules under test (Tier 1 — maximum coverage, all chosen)

Pure / in-memory (cheap):
- `ManifestDiscoverer` — fixture repos asserting discovered manifests.
- `ConfigLoader` — fixture config files asserting parsed objects and validation errors.
- `Linter` — fixture configs asserting emitted error lists for each rule.
- `FindingMatcher` — synthetic findings + accept lists asserting classification.
- `StateTracker` — state-transition assertions.
- `MarkdownReporter` — snapshot assertions on rendered PR-comment markdown.
- `JsonReporter` — snapshot assertions on `.depaudit/findings.json`.

With mocks:
- `OsvScannerAdapter` — mocked subprocess (`execFile`), asserting JSON parse and `Finding` normalization.
- `SocketApiClient` — mocked HTTP (MSW-style), asserting retries, fail-open, normalization.
- `CommitOrPrExecutor` — mocked `execFile` for `git` and `gh`, asserting correct branch decisions.
- `SlackReporter` — mocked HTTP, asserting first-failure-only behavior given a `StateTracker`.

Integration tests:
- `ScanCommand` end-to-end on fixture repos with known findings; assert exit code, PR comment content, `.depaudit/findings.json` content.
- `ScanCommand` orphan-pruning behavior: fixture repo whose `.depaudit.yml` carries a supply-chain accept entry for a `(package, version)` no longer present in the tree; assert the entry is removed from the file on disk after the scan, and that the gate passes.
- `ScanCommand` orphan-pruning fail-open guard: fixture repo with the same stale accept, but with Socket API mocked as unreachable; assert the stale entry is **not** removed, and the gate's supply-chain section is annotated as "unavailable."
- `DepauditSetupCommand` end-to-end on a freshly-cloned fixture repo with pre-existing findings; assert scaffolded files, baseline entries, and commit-vs-PR decision under each branch condition.

### Prior art in this codebase

- `adws/core/__tests__/` — Vitest unit tests for pure modules (`claudeStreamParser`, `phaseRunner`, `projectConfig`, `topLevelState`). Same pattern applies to `FindingMatcher`, `Linter`, `ConfigLoader`.
- `adws/providers/__tests__/` — Vitest tests for provider adapters (`boardManager`, `repoContext`). Same pattern applies to `OsvScannerAdapter` and `SocketApiClient`.
- `adws/triggers/__tests__/` — Vitest tests for stateful logic (`cronStageResolver`, `cronRepoResolver`, `devServerJanitor`). Same pattern applies to `StateTracker` and `CommitOrPrExecutor`.
- `adws/__tests__/` — Vitest integration tests (`adwMerge`, `issueDependencies`, `triggerWebhook`). Same integration pattern applies to `ScanCommand` and `DepauditSetupCommand`.

## Out of Scope

- **Container image / IaC scanning** — depaudit is a dependency-manifest scanner. Container images, Dockerfiles, Kubernetes manifests, Terraform configs, and similar are out of scope. Tools like Trivy or Snyk Container handle that and can coexist with depaudit.
- **Secret scanning** — `gitleaks`, GitHub Secret Scanning, and similar handle this.
- **SAST / code-level vulnerability scanning** — CodeQL, Semgrep, etc. handle this.
- **License compliance** — separate concern; not surfaced by depaudit even when Socket emits license signals.
- **Automated remediation PRs** — depaudit reports and gates; it does not autonomously open upgrade PRs the way Dependabot does. The triage skill can *interactively* perform upgrades during a user session, but there is no autonomous background upgrader.
- **SARIF upload / GitHub Code Scanning** — deliberately excluded to keep acceptance tracking single-source-of-truth in the repo.
- **Self-hosted Socket alternative** — Socket.dev is a hosted SaaS; offline / air-gapped operation is not supported. Repos in air-gapped environments run OSV-Scanner alone (CVE-only coverage).
- **Multi-tenant Slack routing** — Slack notifications route to a single channel per `SLACK_WEBHOOK_URL`. Per-repo channel overrides are not supported.
- **A CLI `depaudit accept` subcommand** — acceptances are added by manual file edit; the `/depaudit-triage` skill is the blessed UX for guided edits. A future UI wrapper may also edit the files.
- **Non-GitHub CI providers in the MVP** — the scaffolded workflow is GitHub Actions. Running `depaudit scan` from GitLab CI, Jenkins, etc. will work (it's a CLI) but the PR-comment and Slack-integration plumbing is GitHub Actions only in the MVP.
- **Dashboard / reporting UI** — the PR comment and Slack notification are the only outputs in the MVP. A future UI wrapper for `/depaudit-triage` is anticipated but out of scope for this PRD.

## Further Notes

- **Baseline entries decay.** Entries written by `depaudit setup` carry `reason: "baselined at install"` — deliberately weak justification. The 90-day expiry forces each baselined finding to be re-evaluated individually within a quarter. Over one release cycle, the register will naturally convert from "baselined" reasons into real decisions.
- **ADW-registered upstreams create a fix-propagation loop.** When the triage skill auto-files an issue on an upstream dependency's repo that is itself ADW-registered (tracked as a project fact), ADW on that repo picks up the issue and begins an SDLC run on it. This is a desirable property for internal cross-repo work; it's effectively harmless for external repos (they simply treat the issue as any other). The user has explicitly agreed to accept the social risk of auto-filing on external upstream repos in exchange for this propagation behavior.
- **Expired baselines surface on the PR they block.** When a baselined entry expires, the next PR to run the gate will fail with a clear "expired acceptance" section in the PR comment. The contributor is not expected to resolve it — the `StateTracker` logic fires the Slack notification to the maintainer once per PR transition.
- **The ubiquitous language.** `ScanCommand` and `DepauditSetupCommand` are named to avoid collision with ADW's `Orchestrator` and `Phase Runner`, which carry specific meanings in the ADW ubiquitous language. depaudit has its own vocabulary (scan, setup, accept, whitelist, trigger branch) that does not overload ADW terms.
- **Future extension: supply-chain coverage for more ecosystems.** Socket's coverage grows over time. As Cargo, Maven, and others reach parity, the graceful-degradation code paths will start surfacing findings in those ecosystems without a schema change — the same `supplyChainAccepts` mechanism applies.
- **`depaudit scan` mutates committed files.** This is an unusual property for a command named "scan." The only mutation is orphan pruning of accept entries whose finding no longer exists; nothing else is ever written to the config files by `scan`. In CI the mutation is ephemeral (no automated commit); locally it surfaces as a diff the developer can commit or discard. The tradeoff was chosen deliberately to avoid the "developer fixed the bug a month ago, now must open a cleanup-only PR to delete stale YAML" failure mode that would otherwise surface when the orphan's expiry passes.
- **Major-bump issues are the only case where the skill files an issue on the current repo.** Every other path either files on an *upstream* dep repo (when the fix must come from the dep's maintainers) or accepts silently with an expiry-driven re-review. Creating an issue on the current repo for routine findings would loop against ADW's auto-pickup behavior; the major-bump case is the exception because the issue represents genuine new engineering work that ADW is expected to execute.
