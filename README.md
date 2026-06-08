# AI Dev Workflow (ADW)

ADW is an agentic SDLC framework: it turns issues on GitHub, GitLab, or Jira into reviewed, tested, and documented pull requests by orchestrating Claude Code agents through a configurable plan → build → test → review → document pipeline.

*Built solo over roughly two months as a way to think seriously about how AI-assisted software systems should be designed, governed, and verified. Self-hosting from week one. The decisions and failure modes below are the substance of what I learned.*

---

## About this project

ADW began as an extension of the foundational orchestration patterns from IndyDevDan's [Agentic Engineer course](https://agenticengineer.com/) and grew over roughly 1,800 commits and 310 merged PRs into a production-shaped framework safe to run unattended against real repositories. It has been self-hosting since the first week — the project's own commits are produced by ADW driving its own implementation, with subjects prefixed `plan-orchestrator:`, `build-agent:`, `alignment-agent:`, `review-patch-agent:`, and so on. Running ADW against its own repository from the first week is where most of the design decisions came from — failures hit fast and had to be fixed before the next session.

The most valuable artifact in this repository isn't the framework. It's the trail of failure modes that reshaped it, and the design decisions that came out of those failures. Most of what I learned about agentic systems came from operating one, not from reading about them.

The sections that follow are the load-bearing parts: the design decisions that turned out to matter, the failure patterns that recurred until I rebuilt the underlying primitive, and the boundaries I deliberately chose not to cross. The operator documentation — setup, configuration, usage — sits below the break.

## Key design decisions

These are the load-bearing choices. Each one was validated by an incident or a repeated failure mode rather than by upfront design.

**Worktree-per-issue, not branch-switching.** Every workflow runs in its own `.worktrees/{branch}/` directory. Concurrent issues mean concurrent worktrees. The cost is disk usage and the complexity of `worktreeReset`. The benefit is zero branch-state contamination, trivially safe parallel runs, and a stuck workflow that can be reclaimed by resetting *its* worktree without touching others.

**Single-host constraint, no clustering.** Cron and webhook triggers are explicitly host-local. The orchestrator-coordination PRD makes this a deployment convention, not a code-level guarantee. The rationale is that cross-host distributed locking adds complexity disproportionate to the benefit — one team, one repo, one host suffices. The escape hatch is `## Cancel`, which performs scorched-earth cleanup on the host that processes it first.

**Stateless auto-merge gate.** The rule is `gate_open = (no hitl on issue) OR (PR is approved)`, re-evaluated on every cron tick rather than cached from workflow start. Human gating becomes a real-time decision: add `hitl` before the PR opens to defer merge, remove it later to re-enable. Any cached state was a source of "why didn't it merge?" support load; the stateless rule is trivially auditable.

**BDD scenarios as the plan/implementation contract.** Scenarios are not just tests — they are the validation surface that catches plan-implementation drift. `validationAgent` and `resolutionAgent` enforce alignment with the issue body. Per-issue scenarios (input only, never executed) were split from regression scenarios (executed) because mixing them caused the runner to fail on draft scenarios and produced ambiguous "is this regression?" decisions.

**LLM diff gate for chores.** Chores skip review and document by default but only auto-merge if Haiku classifies the diff as `safe`. `regression_possible` falls through to the full review path; classifier failure defaults to `regression_possible` (fail-safe). Chore volume is high and full review on every CSS tweak is wasteful, but unguarded auto-merge once produced a regression that triggered this design.

**Cost dual-write (CSV + D1).** Cost tracking originally lived as CSV files committed by ADW into the target repo's git history. This produced a year's worth of merge and rebase bugs in two months (see failure modes below). The eventual fix was not another patch but a model change: dual-write to a Cloudflare D1-backed Worker, decoupling cost from the target repo's git history while keeping local CSV for offline analysis.

**Polymorphic prompts.** Slash command prompts for `/feature`, `/bug`, `/chore`, `/patch`, and `/pr_review` were unified around conditional sections that adapt to the issue type. Earlier each command had its own prompt and they drifted independently. The cutover folded scenario-writing rules and conditional docs into a single shared structure.

**The coordination kernel as a composed set of primitives.** The single most over-engineered part of the codebase, and it earned its complexity through painful production lessons. The kernel is composed of: a per-issue `spawnGate`, PID + start-time liveness checks (reuse-safe), a heartbeat ticker writing `lastSeenAt` to top-level state, a pure-query `hungOrchestratorDetector`, a destructive-but-targeted `worktreeReset`, `remoteReconcile` to derive stage from remote GitHub artifacts when local state is missing, and a `takeoverHandler` that wires all of the above into a single decision tree. None of these existed at the start. Each one came out of a class of bug that scattered point-fixes failed to resolve.

## Recurring failure modes and what they taught me

Mining the git log for `fix:` commits surfaces seven patterns that recurred across the codebase. Each one drove a substantive design change. The trails are kept because the verification — that these are real bugs with real PRs — matters more than the prose.

### Spawn duplication and split-brain

Cron and webhook triggers raced on the same issue, both passing locks, both spawning orchestrators. The trail runs across April 8th to April 20th: scattered patches to spawn deduplication, pause-queue guard ordering, and cross-trigger locking, none of which fully stuck.

The resolution came on April 20th as a single day of merged PRs that rebuilt the coordination layer from scratch: `processLiveness` (PID-reuse-safe), `heartbeat`, `spawnGate` lifetime extended to the full orchestrator life, `hungOrchestratorDetector`, `takeoverHandler` wiring it all together, `remoteReconcile` for stage derivation, and `worktreeReset` for safe takeover. This is the single largest architectural pivot in the project's history.

**Lesson:** scattered point-fixes are a signal that the underlying primitive is wrong. Rebuild the primitive.

### Worktree discovery and branch lookup

Worktrees were being looked up by issue number rather than branch name, or vice versa, causing stale or missing returns. Bugs landed on Feb 26, Mar 3, Apr 26, and Apr 27 — repeatedly, against the same module.

The fix was extracting `vcs/worktreeQuery.ts` as a typed surface and making branch-name assembly deterministic, so every component (planAgent, prAgent, worktree creator, takeoverHandler) computes the same name from the same inputs (`{type, issueNumber, adwId, slug}`).

**Lesson:** identifier coupling that appears innocuous — issue maps to branch maps to worktree — accumulates lookup ambiguity until it's made deterministic at a single point.

### Cost CSV merge and rebase bugs

ADW committed cost CSVs into the target repo's branch. This caused conflicts every time a workflow ran in parallel or after a rebase. Six bugs landed in three days (Mar 6 through Mar 9): unstaged-changes errors, deletion races, rebase errors, then a rewrite of the commit mechanism, then yet another deletion bug.

The eventual fix was not another patch. It was a data-model change: dual-write to a Cloudflare D1-backed Worker, decoupling cost from target-repo git history.

**Lesson:** when fixes pile up against the same module faster than they stick, the data model is wrong.

### State-file overwrite races

`completeWorkflow` was overwriting an `awaiting_merge` stage that had been set later by a different code path. The fix surface ran across April 3rd to April 20th, ending in a formalized stage taxonomy: `discarded` introduced as a terminal state, separate from `abandoned`, and the top-level state schema extended with `pid`, `pidStartedAt`, and `lastSeenAt` fields.

**Lesson:** implicit state machines drift over time. Making them explicit prevents the next race.

### GitHub Project Board flakiness

Board V2 GraphQL operations failed for auth (the default `gh` token works for most things, but project boards require a PAT), lost column order and option IDs on update, and miscolored status options. The fix landed first as scattered patches across April 16th to April 18th, then as a consolidation: a `withProjectBoardAuth` wrapper covering every board operation site.

**Lesson:** when an external API has a non-obvious auth contract, codify it in a single chokepoint *before* every call site grows its own copy.

### Rate limit and token limit detection

False positives on token limits, missing detection of 529 overloaded errors, output tokens not displayed. The fix was twofold: structured JSONL parsing (`claudeStreamParser.ts`) replaced regex against stdout, and an explicit pause and resume queue (`pauseQueue.ts` with `pauseQueueScanner.ts`) replaced ad-hoc retry.

**Lesson:** parsing CLI human-readable output is fragile. Commit to the structured stream early.

### Classifier misidentification

The issue classifier was triggering on `clear` comments, on comment deletes, and on the literal substring "adw" appearing inside other words. Five fixes between March 1st and April 9th, culminating in the `## Cancel` directive replacing the bare-word `clear`/`adw` heuristic.

**Lesson:** trigger-by-substring is convenient until the trigger word collides with normal English. An explicit, intentional directive parses reliably.

## Status

ADW is a working open-source agentic SDLC framework demonstrating multi-agent orchestration, governance gating, multi-provider abstraction, cost telemetry, and DDD ubiquitous language as a real system rather than slideware. It is not actively seeking contributors and is not pitched as a product. It exists as substrate for evaluating architectural trade-offs around AI in enterprise SDLCs, and as a way for me to do that thinking concretely rather than in the abstract.

If you want to evaluate the codebase directly, the recommended reading order is:

1. `adws/adwSdlc.tsx` — the canonical full pipeline, around 150 lines, reads top-to-bottom.
2. `adws/triggers/trigger_cron.ts` together with `adws/triggers/takeoverHandler.ts` — the control loop.
3. `adws/phases/orchestratorLock.ts` together with `adws/triggers/spawnGate.ts` — the locking model.
4. `adws/core/processLiveness.ts`, `adws/core/heartbeat.ts`, and `adws/core/hungOrchestratorDetector.ts` — the liveness model.
5. `adws/providers/repoContext.ts` together with `adws/providers/types.ts` — the provider abstraction.
6. [UBIQUITOUS_LANGUAGE.md](UBIQUITOUS_LANGUAGE.md) — domain terms (Workflow, Phase, Stage, Orchestrator, Worktree, Spawn Lock, Takeover, etc.). Worth reading before any unfamiliar phase.
7. [specs/prd/orchestrator-coordination-resilience.md](specs/prd/orchestrator-coordination-resilience.md) — the design rationale for the coordination kernel.

---

## Operator documentation

Everything below is for someone who wants to run ADW against a target repository. The framing above is for someone evaluating the codebase or its author.

## What it does

- **End-to-end SDLC orchestration** — `adwSdlc.tsx` composes plan, plan-validation, build, test, PR, review, auto-merge, and document phases into a single pipeline per issue.
- **Composable orchestrators** — run individual phases (`adwPlan`, `adwBuild`, `adwTest`, `adwDocument`, `adwPrReview`, `adwPatch`, `adwMerge`) or pre-wired combos (`adwPlanBuild`, `adwPlanBuildTest`, `adwPlanBuildReview`, `adwPlanBuildDocument`, `adwPlanBuildTestReview`).
- **Issue classification & routing** — auto-classifies an issue as `/chore`, `/bug`, `/feature`, or `/pr_review` and routes it to the right orchestrator; explicit ADW slash commands override the heuristic; `adw:*` GitHub labels provide a third classification path that bypasses AI heuristics entirely.
- **Chore fast-path with LLM diff gate** — `adwChore` builds, runs unit tests, opens a PR, then asks Haiku to classify the diff as `safe` (auto-merge) or `regression_possible` (full review path).
- **BDD/scenario-driven validation** — discovers `.feature` files tagged `@adw-{issueNumber}`, generates step definitions, and reconciles plan vs. scenario coverage via `validationAgent`, `alignmentPhase`, and `resolutionAgent`.
- **Multi-agent passive review** — review agents read scenario proof and captured screenshots, classifying findings as Blockers (auto-patched by `patchAgent` for general failures or `refactorAgent` for coding-guideline violations, via `reviewPatchHelpers`) or Tech Debt (logged only).
- **HITL-gated auto-merge** — every cron tick re-evaluates `(no hitl label) OR (PR approved)`; merge is deferred while the gate is closed, and `## Cancel` is the scorched-earth manual override.
- **Retry and Cancel directives** — `## Retry` resets a `merge_blocked` workflow to `awaiting_merge` (state-only, no worktree teardown); `## Cancel` kills the orchestrator, removes the worktree, and re-queues the issue.
- **Multi-provider abstraction** — pluggable `IssueTracker` and `CodeHost` interfaces (`RepoContext`) with GitHub, GitLab, and Jira issue trackers and GitHub/GitLab code hosts.
- **Project board automation** — `BoardManager` provider drives GitHub Projects V2 column transitions as a workflow progresses.
- **Two automation triggers** — `trigger_cron.ts` polls every 20 s; `trigger_webhook.ts` receives HMAC-signed GitHub webhooks for instant pickup, with optional Cloudflare tunnel lifecycle.
- **Single-host coordination** — per-issue `spawnGate`, PID + start-time liveness checks, heartbeat ticker, and `worktreeReset`-driven takeover reclaim dead or abandoned runs.
- **Resilience primitives** — pause queue for rate-limit/billing pause and resume, auth gate for auth-failure detection with `paused_auth` state and Slack alerting, auth queue scanner for automatic resume after auth restoration, hung-orchestrator detector, dev server janitor, per-issue scenario sweep cron (14-day retention), and `remoteReconcile` to derive workflow stage from remote GitHub artifacts.
- **Cost tracking** — per-phase, per-model `PhaseCostRecord` with multi-currency reporting, divergence detection vs. CLI-reported cost, and dual-write to a Cloudflare D1-backed Cost API.
- **Agentic KPI tracking** — `kpiAgent` and `kpiPhase` record per-workflow success, duration, cost, and streak metrics to a persistent `agentic_kpis.md` file for analytics and accountability.
- **LLM-based dependency extraction** — `dependencyExtractionAgent` reads issues to surface cross-issue dependencies before spawning.
- **Documentation generation** — `documentAgent` writes feature docs to `app_docs/`; the SDLC pipeline includes review screenshots.
- **Scenario promotion sweep** — `adwPromotionSweep.tsx` scores per-issue scenarios against the regression vocabulary registry; high-scoring candidates receive a `@promotion-suggested-<date>` tag with daily-cadence suppression, date refresh, and score-drop withdrawal; a PR comment lists all candidates and applies the `hitl` label; human-approved scenarios (`@promotion`) are automatically moved to the regression suite via a dedicated PR.
- **Framework auto-upgrade** — `adwUpgrade.tsx` regenerates a target repo's `.adw/` configuration when the framework hash changes, using an atomic upgrade-claim via a GitHub branch namespace (winner/loser resolution) so only one host runs the regen per hash version. The upgrade PR auto-merges by default; a target repo can require human review by committing `.github/adw.yml` with `hitl: true` (kept outside `.adw/` so regeneration cannot clobber it).
- **Observability-surfaces drafting** — `adw_init` classifies a target repo's stack (browser-test-equipped, CLI-only, or fallback) and LLM-drafts the `## Observability Surfaces (Examples)` block in `features/regression/vocabulary.md`, seeding the promotion scorer with repo-specific surface types rather than leaving a blank placeholder.
- **Supply-chain audit integration** — `adw_init` runs `depaudit setup` in target repos and propagates `SOCKET_API_TOKEN` / `SLACK_WEBHOOK_URL` to GitHub Actions secrets.
- **Screenshot upload pipeline** — Cloudflare R2 bucket manager + `screenshot-router` Worker for hosting review screenshots under `screenshots.paysdoc.nl`.
- **Worktree isolation** — every workflow runs in its own git worktree (`.worktrees/{branch}/`) so multiple issues can be processed concurrently without interference.
- **Adaptable target repos** — `.adw/` config (`commands.md`, `project.md`, `providers.md`, `scenarios.md`, `review_proof.md`, `conditional_docs.md`, `coding_guidelines.md`) lets a target repo configure package manager, test/lint/dev commands, scenario layout, and review proof rules.
- **DDD ubiquitous language** — domain terms (Workflow, Phase, Stage, Orchestrator, Worktree, Spawn Lock, Takeover, etc.) are formalized in `UBIQUITOUS_LANGUAGE.md` and used consistently across code, docs, and agent prompts.

## Acknowledgments

ADW would not exist without the work of these contributors:

- **[IndyDevDan](https://github.com/disler)** — his [Agentic Engineer course](https://agenticengineer.com/) provided the foundational codebase that ADW grew out of. The original orchestration patterns and agent composition came from there.
- **[Matt Pocock](https://github.com/mattpocock)** — his [skills repository](https://github.com/mattpocock/skills) contributed several of the Claude skills used throughout ADW.

Thank you both.

## Setup

### 1. Install Prerequisites

**Required:**

| Tool | Purpose | Install (macOS) | Install (Linux) |
|------|---------|-----------------|-----------------|
| [Node.js](https://nodejs.org/) (>= 18) | Required by Claude Code CLI | `brew install node` | `sudo apt install nodejs` |
| [Git](https://git-scm.com/) | Version control, worktrees, branching | `brew install git` | `sudo apt install git` |
| [Bun](https://bun.sh/) | Runtime, package manager, script runner | `brew install oven-sh/bun/bun` | `curl -fsSL https://bun.sh/install \| bash` |
| [GitHub CLI](https://cli.github.com/) | Issue/PR operations, GraphQL, auth | `brew install gh` | `sudo apt install gh` |
| [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) | AI agent execution | `npm install -g @anthropic-ai/claude-code` | `npm install -g @anthropic-ai/claude-code` |

**Optional:**

| Tool | Purpose | Install (macOS) | Install (Linux) |
|------|---------|-----------------|-----------------|
| [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) | Cloudflare tunnel for webhook server | `brew install cloudflared` | See Cloudflare docs |
| [Docker](https://www.docker.com/) | BDD test isolation in containers | `brew install --cask docker` | `sudo apt install docker.io` |
| [depaudit](https://github.com/paysdoc/depaudit) | Supply-chain audit tooling; auto-installed into target repos by `adw_init` | `npm install -g depaudit` | `npm install -g depaudit` |

**System utilities** (pre-installed on macOS and most Linux distributions):
- `lsof` — used by the dev server janitor and worktree cleanup to find processes holding file handles
- `which` — used for health checks and CLI binary resolution

```bash
# Authenticate GitHub
gh auth login
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Configure Environment

Copy the root-level `.env.sample` to `.env` and fill in the required values:

```bash
cp .env.sample .env
# Then edit .env with your actual credentials and configuration
```

Required and optional environment variables (see `.env.sample` for full reference):
- `GITHUB_REPO_URL` - Your GitHub repository URL
- `ANTHROPIC_API_KEY` - Your Anthropic API key
- `CLAUDE_CODE_PATH` - (Optional) Path to Claude CLI, defaults to `claude`
- `GITHUB_PAT` - (Optional) GitHub personal access token, only needed if using a different account than `gh auth login`. Use a classic PAT with the `project` scope for Projects V2 board automation — fine-grained `github_pat_...` tokens are unreliable against Projects V2 GraphQL on user-owned boards. **Migration note:** the legacy `GITHUB_PERSONAL_ACCESS_TOKEN` alias is no longer read; operators must set `GITHUB_PAT`.
- `GITHUB_APP_ID` - (Optional) GitHub App ID for app-based authentication (comments appear as the app)
- `GITHUB_APP_SLUG` - (Optional) GitHub App slug, used with `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY_PATH` - (Optional) Path to GitHub App private key PEM file
- `GITHUB_WEBHOOK_SECRET` - (Optional) Required only for webhook trigger
- `TARGET_REPOS_DIR` - (Optional) Directory for storing cloned target repository workspaces, defaults to `~/.adw/repos`
- `MAX_CONCURRENT_PER_REPO` - (Optional) Maximum concurrent in-progress issues per repository, defaults to `5`
- `RUNNING_TOKENS` - (Optional) Show running token totals in issue comments, defaults to `false`
- `SHOW_COST_IN_COMMENTS` - (Optional) Show cost breakdowns in GitHub issue/PR comments, defaults to `false`
- `JIRA_BASE_URL` - (Optional) Jira instance URL, required only when using Jira as the issue tracker
- `JIRA_PROJECT_KEY` - (Optional) Default Jira project key
- `JIRA_EMAIL` - (Optional) Jira Cloud auth email
- `JIRA_API_TOKEN` - (Optional) Jira Cloud API token
- `JIRA_PAT` - (Optional) Jira Data Center/Server personal access token (use instead of email + API token)
- `GITLAB_TOKEN` - (Optional) GitLab personal access token (needs api scope), required only when using GitLab
- `GITLAB_INSTANCE_URL` - (Optional) GitLab instance URL, defaults to `https://gitlab.com`
- `CLOUDFLARE_ACCOUNT_ID` - (Optional) Cloudflare account ID, required only for screenshot upload functionality
- `R2_ACCESS_KEY_ID` - (Optional) R2 access key ID, required only for screenshot upload functionality
- `R2_SECRET_ACCESS_KEY` - (Optional) R2 secret access key, required only for screenshot upload functionality
- `COST_API_URL` - (Optional) Cost API Worker URL for D1 cost database writes (e.g., `https://costs.paysdoc.nl`)
- `COST_API_TOKEN` - (Optional) Bearer token for Cost API authentication
- `SLACK_WEBHOOK_URL` - (Optional) Slack Incoming Webhook URL for error/problem reporting. Propagated by `adw_init` to each target repo's GitHub Actions secrets via `gh secret set`. Missing values are logged as warnings and do not fail init.
- `SOCKET_API_TOKEN` - (Optional) Socket.dev API token for supply-chain scanning (required only for depaudit). Propagated by `adw_init` to each target repo's GitHub Actions secrets via `gh secret set`. Missing values are logged as warnings and do not fail init.

### 4. Run `adw_init` to bootstrap a target repo

`adw_init` initializes a target repository with `.adw/` configuration and supply-chain tooling:

```bash
bunx tsx adws/adwInit.tsx 42 --target-repo https://github.com/owner/repo
```

**Phase order:** clone → `/adw_init` → copy skills/commands → `depaudit setup` → commit → PR

During `depaudit setup`, `adw_init` runs `depaudit setup` in the target repo worktree (requires `npm install -g depaudit` on the ADW host) and propagates `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` to the target repo's GitHub Actions secrets via `gh secret set`. If either env var is missing, a warning is logged and `adw_init` continues.

### 5. Run ADW

```bash
# Process a single issue (plan + build)
bunx tsx adws/adwPlanBuild.tsx 123

# Full pipeline with testing
bunx tsx adws/adwPlanBuildTest.tsx 123

# Complete SDLC (plan + build + test + review + document)
bunx tsx adws/adwSdlc.tsx 123
```

See [adws/README.md](adws/README.md) for full usage documentation.

## Single-host constraint

For a given repository, only one host may run `trigger_cron.ts` and `trigger_webhook.ts` at a time. This is a deployment convention, not enforced by code.

**Why it matters:** the per-issue spawn lock ([`adws/triggers/spawnGate.ts`](adws/triggers/spawnGate.ts)), the PID+start-time liveness check, the heartbeat ticker, and the worktree-reset recovery path are all host-local. They cannot detect or coordinate with an orchestrator running on a different machine.

**This is undefined territory, not degraded performance.** Running two hosts against one repo can produce:
- Split-brain spawns: two orchestrators claiming the same issue simultaneously
- Two pull requests targeting the same issue branch
- Clobbered worktrees when one host resets what the other is writing
- Misclassified liveness: hung-detector logic reading remote-host PIDs as dead

The design makes no attempt to predict or recover from these outcomes.

**Safe alternative:** for development or testing, point the dev host at a fork or a dedicated test repo. Never share a production repo between a laptop cron and a production server cron.

**Escape hatch:** if you suspect split-brain (duplicate spawns, stranded worktrees, conflicting branches), post `## Cancel` on the affected issue. The next cron cycle or webhook event that picks it up will run the scorched-earth cleanup: kill agent processes, remove worktrees, delete state directories, and clear GitHub comments. The issue re-enters the queue on the following cycle.

See [adws/README.md](adws/README.md#single-host-constraint) for the full operator guidance and split-brain failure mode.

## Auto-merge gate

Every `awaiting_merge` issue is re-evaluated on each cron tick using a single stateless rule:

```
gate_open = (no hitl on issue) OR (PR is approved)
```

The four canonical rules:

1. **No `hitl` label on the issue** → `gate_open = true` → auto-merge fires (any issue type — chore, bug, feature).
2. **`hitl` on issue, PR not approved** → `gate_open = false` → defer (no state write, no comment; cron re-checks next tick).
3. **`hitl` on issue, PR approved** → `gate_open = true` → auto-merge fires (order of events irrelevant).
4. **`hitl` removed (with or without approval)** → falls back to rule 1 → auto-merge becomes eligible again on the next cron tick.

**Disciplined pre-add workflow:** if you want a merge to be human-gated, add the `hitl` label to the issue **before** the orchestrator opens the PR. The gate is checked in real time — not cached from workflow start.

**`## Cancel` interaction:** after cancel + re-run, the new run's gate evaluates the **current** label state — the gate is stateless, so removing `hitl` between cycles is sufficient to re-enable auto-merge. A human who wants to truly stop a merge mid-race must post `## Cancel` to stop the workflow entirely.

**Chore pipeline:** the chore pipeline now uses the same gate as bug/feature pipelines. `adwChore.tsx` writes `awaiting_merge` after PR creation and delegates merging to `adwMerge.tsx` via the cron — there is one merge path and one gate.

## Domain Language

ADW uses a DDD-style ubiquitous language to keep code, documentation, and conversation aligned. See [UBIQUITOUS_LANGUAGE.md](UBIQUITOUS_LANGUAGE.md) for canonical term definitions, aliases to avoid, and a worked example dialogue.

## Testing

ADW uses BDD scenarios for validation (see `.adw/scenarios.md`).

### BDD scenario layout

| Directory | Purpose |
|---|---|
| `features/regression/` | Promoted regression suite — executed by the test runner (`cucumber.js` is scoped here). |
| `features/per-issue/` | Per-issue agent-input scenarios — **never** executed by the runner; retained for 14 days after the issue's PR merges and then swept by the cron probe. File naming: `feature-{issueNumber}.feature`. |

Top-level `features/*.feature` files were removed in the BDD cutover (issue #493). All promoted scenarios now live exclusively under `features/regression/`.

### `.adw/scenarios.md` optional sections

Three optional sections activate the regression-suite contract. When absent, the `scenario_writer` and `generate_step_definitions` prompts use their legacy free-form behaviour.

| Section | Effect when present |
|---|---|
| `## Per-Issue Scenario Directory` | `scenario_writer` routes per-issue output to `<value>/feature-{N}.feature` instead of the fallback directory. |
| `## Regression Scenario Directory` | `scenario_writer` skips the `@regression` auto-promotion sweep (regression promotion becomes a deliberate human decision). |
| `## Vocabulary Registry` | `generate_step_definitions` validates every step phrase against the registry file; fails loudly on unknown phrases. |

### Scenario Promotion

ADW supports a human-in-the-loop (HITL) promotion flow that moves high-quality per-issue scenarios into the regression suite via a deliberate human approval signal.

**`@promotion-suggested-<date>`** — applied automatically by the `promotionCommenter` orchestrator when a per-issue scenario scores above the promotion threshold against the vocabulary registry. The date suffix records when the suggestion was made. Operators should treat this as a recommendation, not a directive.

**`@promotion`** — applied by a human by editing the `@promotion-suggested-<date>` tag (removing the date suffix). This is the approval signal. The bare `@promotion` token (no date) tells the agent "move this into regression on the next run."

**The move PR** — on the next per-issue PR event, the `promotionMover` orchestrator detects any scenario carrying bare `@promotion`, opens a separate PR (branch `regression-promotion-issue-{N}-{slug}`, labelled `regression-promotion`) that moves the scenario block from `features/per-issue/feature-{N}.feature` into the directory configured in `.adw/scenarios.md` (`## Regression Scenario Directory`), and strips both `@promotion` and any `@promotion-suggested-<date>` tokens from the destination. The source scenario is removed from the per-issue file on the same branch.

**14-day sweep** — `@promotion-suggested-<date>` tags that are never edited to `@promotion` are swept after 14 days by the per-issue scenario cron probe (see `app_docs/feature-oobdbg-bdd-cutover-polymorphic-prompts-sweep.md`). Ignoring a suggestion has no penalty; the scenario stays in `features/per-issue/` until the 14-day TTL expires.

**Orchestrator CLI** — `bunx tsx adws/adwPromotionSweep.tsx <issueNumber> [adwId]` runs both halves (commenter then mover) on the same per-issue PR event. The `regression-promotion` GitHub label must already exist on the repository before the mover can apply it.

### Running BDD scenarios on the host

```bash
# Run all @regression scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Run a specific tag
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@mock-infrastructure"
```

### Docker (optional)

A generic Docker image (`test/Dockerfile`) provides an isolated runtime (Bun + Git) so
the full `@regression` suite can run inside a container without host-specific dependencies.
The image is generic — no ADW source code is baked in; the repo is mounted read-only at run
time. `TEST_RUNTIME=docker` is set automatically inside the container.

```bash
# Build the image once
bun run test:docker:build

# Run @regression scenarios inside the container (same results as host)
bun run test:docker

# Run a specific tag inside the container
bash test/docker-run.sh --tags "@mock-infrastructure"

# Open an interactive shell for debugging
bash test/docker-run.sh --shell
```

Docker execution is entirely optional — the test suite runs identically on the host without it.

## Project Structure

```
.adw/                   # Project configuration for ADW (see adws/README.md)
├── coding_guidelines.md # Coding guidelines (fallback: guidelines/coding_guidelines.md for older repos)
├── commands.md         # Build/test/lint command mappings
├── conditional_docs.md # Conditional documentation paths
├── project.md          # Project structure and relevant files
├── providers.md        # Provider configuration (issue tracker, code host)
├── review_proof.md     # Review proof requirements for target projects
└── scenarios.md        # BDD scenario configuration
.claude/
├── commands/           # Claude Code slash commands
│   ├── adw_init.md
│   ├── align_plan_scenarios.md
│   ├── bug.md
│   ├── chore.md
│   ├── classify_issue.md
│   ├── clean_local_repo.md
│   ├── commit.md
│   ├── diff_evaluator.md
│   ├── conditional_docs.md
│   ├── document.md
│   ├── extract_dependencies.md
│   ├── feature.md
│   ├── find_issue_dependencies.md
│   ├── generate_branch_name.md
│   ├── generate_step_definitions.md
│   ├── implement.md
│   ├── install.md
│   ├── patch.md
│   ├── pr_review.md
│   ├── prime.md
│   ├── pull_request.md
│   ├── resolve_conflict.md
│   ├── resolve_failed_scenario.md
│   ├── resolve_failed_test.md
│   ├── resolve_plan_scenarios.md
│   ├── review.md
│   ├── scenario_writer.md
│   ├── test.md
│   ├── tools.md
│   ├── track_agentic_kpis.md
│   └── validate_plan_scenarios.md
├── hooks/              # Claude Code hooks
│   ├── notification.ts
│   ├── post-tool-use.ts
│   ├── pre-tool-use.ts
│   ├── stop.ts
│   ├── subagent-stop.ts
│   └── utils/
│       └── constants.ts
├── skills/             # Claude Code skills
│   ├── depaudit-triage/
│   │   └── SKILL.md
│   ├── grill-me/
│   │   └── SKILL.md
│   ├── improve-codebase-architecture/
│   │   ├── REFERENCE.md
│   │   └── SKILL.md
│   ├── prd-to-issues/
│   │   └── SKILL.md
│   ├── refactor/
│   │   └── SKILL.md
│   ├── implement-tdd/
│   │   ├── SKILL.md
│   │   ├── deep-modules.md
│   │   ├── interface-design.md
│   │   ├── mocking.md
│   │   ├── refactoring.md
│   │   └── tests.md
│   ├── tdd/
│   │   ├── SKILL.md
│   │   ├── deep-modules.md
│   │   ├── interface-design.md
│   │   ├── mocking.md
│   │   ├── refactoring.md
│   │   └── tests.md
│   ├── ubiquitous-language/
│   │   └── SKILL.md
│   ├── write-a-prd/
│   │   └── SKILL.md
│   └── write-a-skill/
│       └── SKILL.md
└── settings.json
templates/              # ADW framework-level templates
└── vocabulary.md.template  # Seed template for target-repo regression vocabulary registries
adws/                   # ADW workflow system
├── __tests__/          # Vitest integration tests
│   ├── adwMerge.test.ts
│   ├── adwUpgrade.test.ts
│   ├── depauditSetup.test.ts
│   ├── issueDependencies.test.ts
│   ├── triggerWebhook.test.ts
│   └── vocabularyTemplate.test.ts
├── agents/             # Claude Code agent runners
│   ├── __tests__/      # Vitest unit tests
│   │   ├── claudeAgent.test.ts
│   │   ├── gitAgent.test.ts
│   │   └── refactorAgent.test.ts
│   ├── agentProcessHandler.ts  # Process spawning handler
│   ├── alignmentAgent.ts  # Single-pass alignment agent
│   ├── bddScenarioRunner.ts  # BDD scenario execution
│   ├── buildAgent.ts
│   ├── claudeAgent.ts
│   ├── commandAgent.ts  # Generic thin-wrapper agent for slash commands
│   ├── diffEvaluatorAgent.ts  # LLM-based diff safety classification (Haiku)
│   ├── dependencyExtractionAgent.ts  # LLM-based issue dependency extraction
│   ├── documentAgent.ts
│   ├── gitAgent.ts
│   ├── index.ts
│   ├── jsonlParser.ts
│   ├── installAgent.ts # Install phase agent
│   ├── kpiAgent.ts     # KPI tracking agent
│   ├── patchAgent.ts
│   ├── planAgent.ts
│   ├── prAgent.ts
│   ├── refactorAgent.ts  # Applies coding-guideline fixes via the /refactor skill (mirrors patchAgent for guideline violations)
│   ├── resolutionAgent.ts  # Plan-scenario mismatch resolution
│   ├── reviewAgent.ts
│   ├── scenarioAgent.ts  # BDD scenario planner agent
│   ├── stepDefAgent.ts  # Step definition generation agent
│   ├── testAgent.ts
│   ├── testRetry.ts
│   └── validationAgent.ts  # Plan-scenario validation
├── core/               # Configuration and utilities
│   ├── __tests__/      # Vitest unit tests
│   │   ├── adwVersion.test.ts
│   │   ├── authGate.test.ts
│   │   ├── claudeStreamParser.test.ts
│   │   ├── devServerLifecycle.test.ts
│   │   ├── environment.test.ts
│   │   ├── execWithRetry.test.ts
│   │   ├── hashComputer.test.ts
│   │   ├── heartbeat.test.ts
│   │   ├── hungOrchestratorDetector.test.ts
│   │   ├── phaseRunner.test.ts
│   │   ├── processLiveness.test.ts
│   │   ├── projectConfig.test.ts
│   │   ├── remoteReconcile.test.ts
│   │   ├── slackNotifier.test.ts
│   │   ├── stateHelpers.test.ts
│   │   ├── topLevelState.test.ts
│   │   ├── upgradeClaim.integration.test.ts
│   │   ├── upgradeClaim.test.ts
│   │   └── workflowCommentParsing.test.ts
│   ├── adwId.ts        # ADW ID generation
│   ├── adwVersion.ts   # Read/write .adw-version file (stores framework hash at target repo root)
│   ├── agentState.ts
│   ├── authGate.ts     # Host-wide auth gate: detects auth failures, writes paused_auth state, triggers Slack alerts
│   ├── claudeStreamParser.ts  # Claude JSONL stream parsing
│   ├── config.ts
│   ├── constants.ts    # Orchestrator ID constants
│   ├── devServerLifecycle.ts  # Dev server spawn, health probe, and cleanup helpers
│   ├── environment.ts  # Environment variable accessors
│   ├── hashComputer.ts # SHA256 hash of declared hashInputs files — "current framework version" primitive
│   ├── heartbeat.ts    # Liveness ticker writing lastSeenAt to state on a fixed interval
│   ├── hungOrchestratorDetector.ts  # Pure-query detector for wedged orchestrators (live PID + stale heartbeat)
│   ├── index.ts
│   ├── issueClassifier.ts
│   ├── jsonParser.ts
│   ├── logger.ts       # Structured logging utilities
│   ├── modelRouting.ts # Model/effort routing utilities
│   ├── orchestratorCli.ts  # Shared CLI parsing utilities
│   ├── orchestratorLib.ts
│   ├── agentTimeouts.ts  # Per-phase agent timeout constants
│   ├── pauseQueue.ts   # Pause queue for rate-limit pause/resume
│   ├── phaseRunner.ts  # PhaseRunner / CostTracker composition
│   ├── portAllocator.ts
│   ├── processKill.ts  # Process kill utilities (SIGTERM → SIGKILL escalation)
│   ├── processLiveness.ts  # PID-reuse-safe process liveness checks
│   ├── projectConfig.ts
│   ├── remoteReconcile.ts  # Stage derivation from remote GitHub artifacts
│   ├── retryOrchestrator.ts
│   ├── slackNotifier.ts  # Slack Incoming Webhook client for error/problem alerting
│   ├── stateHelpers.ts
│   ├── targetRepoManager.ts
│   ├── upgradeClaim.ts # Atomic upgrade-claim primitive via GitHub branch namespace (winner/loser resolution)
│   ├── utils.ts
│   ├── workflowCommentParsing.ts  # Comment parsing utilities
│   └── workflowMapping.ts  # Issue type → orchestrator mapping
├── github/             # GitHub API operations
│   ├── __tests__/      # Vitest unit tests
│   │   ├── labelManager.test.ts
│   │   └── prApi.test.ts
│   ├── githubApi.ts
│   ├── githubAppAuth.ts  # GitHub App authentication
│   ├── index.ts
│   ├── issueApi.ts
│   ├── labelManager.ts  # adw:* label lifecycle management and label-based issue classification
│   ├── prApi.ts
│   ├── prCommentDetector.ts
│   ├── projectBoardApi.ts
│   ├── proofCommentFormatter.ts
│   ├── workflowComments.ts
│   ├── workflowCommentsBase.ts
│   ├── workflowCommentsIssue.ts
│   └── workflowCommentsPR.ts
├── vcs/                # Version control operations (git)
│   ├── __tests__/      # Vitest unit tests
│   │   ├── branchOperations.test.ts
│   │   ├── commitOperations.test.ts
│   │   └── worktreeReset.test.ts
│   ├── branchOperations.ts  # Branch management
│   ├── commitOperations.ts  # Commit/push operations
│   ├── index.ts
│   ├── worktreeCleanup.ts
│   ├── worktreeCreation.ts
│   ├── worktreeOperations.ts
│   ├── worktreeQuery.ts  # Worktree query utilities
│   └── worktreeReset.ts  # Worktree reset to remote for takeover/recovery
├── cost/               # Cost tracking module
│   ├── __tests__/      # Vitest unit tests
│   │   ├── computation.test.ts
│   │   └── extractor.test.ts
│   ├── providers/anthropic/  # Anthropic token usage extraction
│   │   ├── extractor.ts
│   │   ├── index.ts
│   │   └── pricing.ts
│   ├── reporting/      # Cost reporting
│   │   ├── commentFormatter.ts
│   │   └── index.ts
│   ├── computation.ts  # Cost computation logic
│   ├── costHelpers.ts  # Shared cost utility helpers
│   ├── d1Client.ts     # D1 HTTP client — posts PhaseCostRecords to Cost API Worker
│   ├── exchangeRates.ts
│   ├── index.ts
│   └── types.ts
├── jsonl/              # JSONL schema validation and fixtures
│   ├── fixtures/       # JSONL fixture files for testing
│   │   ├── README.md
│   │   ├── assistant-text.jsonl
│   │   ├── assistant-tool-use.jsonl
│   │   ├── result-error.jsonl
│   │   └── result-success.jsonl
│   ├── conformanceCheck.ts  # JSONL conformance validation
│   ├── fixtureUpdater.ts    # Fixture update utility
│   ├── index.ts
│   ├── schema.json          # JSONL envelope schema
│   ├── schemaProbe.ts       # Schema probe utility
│   └── types.ts
├── phases/             # Workflow phase implementations
│   ├── __tests__/      # Vitest unit tests
│   │   ├── branchNameResolution.test.ts
│   │   ├── orchestratorLock.test.ts
│   │   ├── reviewPhase.test.ts
│   │   ├── scenarioTestPhase.test.ts
│   │   └── workflowInit.test.ts
│   ├── alignmentPhase.ts  # Single-pass alignment phase
│   ├── authPause.ts    # Auth-required pause handler (mirrors rate-limit pause path for auth failures)
│   ├── autoMergePhase.ts  # Auto-approve and merge PR after review passes
│   ├── branchNameResolution.ts  # Branch name resolution for worktree takeover paths
│   ├── diffEvaluationPhase.ts  # LLM diff evaluation phase (safe vs regression_possible)
│   ├── buildPhase.ts
│   ├── documentPhase.ts
│   ├── index.ts
│   ├── depauditSetup.ts  # depaudit setup and secret propagation (used by adw_init)
│   ├── installPhase.ts # Install phase implementation
│   ├── kpiPhase.ts     # KPI tracking phase
│   ├── orchestratorLock.ts  # Orchestrator-lifetime spawn lock (acquire/release wrapper)
│   ├── phaseCommentHelpers.ts  # Shared phase comment utilities
│   ├── planPhase.ts
│   ├── planValidationPhase.ts  # Plan-scenario validation phase
│   ├── prPhase.ts
│   ├── prReviewCompletion.ts  # PR review completion/error handling
│   ├── prReviewPhase.ts  # PR review phase implementation
│   ├── reviewPatchHelpers.ts  # Dispatches review blockers to patchAgent or refactorAgent based on blocker type
│   ├── reviewPhase.ts  # Passive judge review phase (reads scenario proof, no dev server)
│   ├── scenarioFixPhase.ts  # Fixes failed scenarios from a previous scenarioTestPhase run
│   ├── scenarioPhase.ts  # BDD scenario generation phase
│   ├── scenarioProof.ts  # Scenario proof orchestrator (relocated from agents/)
│   ├── scenarioTestPhase.ts  # Runs BDD scenarios tagged @adw-{issueNumber} and @regression
│   ├── stepDefPhase.ts  # Step definition generation phase
│   ├── unitTestPhase.ts  # Unit test phase (opt-in, BDD scenarios moved to scenarioTestPhase)
│   ├── workflowCompletion.ts  # Workflow completion/error handling
│   ├── workflowInit.ts  # Workflow initialization
│   └── worktreeSetup.ts  # Gitignore and worktree setup helpers
├── types/              # Type definitions
│   ├── agentTypes.ts
│   ├── dataTypes.ts
│   ├── index.ts
│   ├── issueRouting.ts  # Issue routing type definitions
│   ├── issueTypes.ts
│   └── workflowTypes.ts
├── providers/          # Provider interfaces and implementations
│   ├── __tests__/      # Vitest unit tests
│   │   ├── boardManager.test.ts
│   │   └── repoContext.test.ts
│   ├── github/         # GitHub provider
│   │   ├── githubBoardManager.ts  # GitHub Projects V2 board management
│   │   ├── githubCodeHost.ts
│   │   ├── githubIssueTracker.ts
│   │   ├── index.ts
│   │   └── mappers.ts
│   ├── gitlab/         # GitLab provider
│   │   ├── gitlabApiClient.ts
│   │   ├── gitlabBoardManager.ts  # Stub (not implemented)
│   │   ├── gitlabCodeHost.ts
│   │   ├── gitlabTypes.ts
│   │   ├── index.ts
│   │   └── mappers.ts
│   ├── jira/           # Jira provider
│   │   ├── adfConverter.ts
│   │   ├── index.ts
│   │   ├── jiraApiClient.ts
│   │   ├── jiraBoardManager.ts  # Stub (not implemented)
│   │   ├── jiraIssueTracker.ts
│   │   └── jiraTypes.ts
│   ├── index.ts
│   ├── repoContext.ts  # RepoContext factory
│   └── types.ts
├── triggers/           # Automation triggers
│   ├── __tests__/      # Vitest unit tests
│   │   ├── autoMergeHandler.test.ts
│   │   ├── cancelHandler.test.ts
│   │   ├── cronIssueFilter.test.ts
│   │   ├── cronRepoResolver.test.ts
│   │   ├── cronStageResolver.test.ts
│   │   ├── devServerJanitor.test.ts
│   │   ├── mergeDispatchGate.test.ts
│   │   ├── pauseQueueScanner.test.ts
│   │   ├── perIssueScenarioSweep.test.ts
│   │   ├── retryHandler.test.ts
│   │   ├── issueOpenedRouter.test.ts
│   │   ├── scanAuthQueue.test.ts
│   │   ├── spawnGate.test.ts
│   │   ├── takeoverHandler.test.ts  # Unit tests for all takeoverHandler decision-tree branches
│   │   ├── takeoverHandler.integration.test.ts  # Integration test for the abandoned takeover path
│   │   ├── trigger_cron.test.ts
│   │   ├── triggerCronAwaitingMerge.test.ts
│   │   └── webhookHandlers.test.ts
│   ├── autoMergeHandler.ts  # Auto-merge approved PRs
│   ├── cancelHandler.ts  # Cancel directive handler
│   ├── retryHandler.ts   # Retry directive handler: resets merge_blocked → awaiting_merge, no worktree teardown
│   ├── cloudflareTunnel.tsx  # Cloudflare tunnel lifecycle helper
│   ├── concurrencyGuard.ts
│   ├── cronIssueFilter.ts  # Cron issue evaluation and filtering logic (testable, extracted from trigger_cron)
│   ├── devServerJanitor.ts  # Janitor probe that kills stale dev server processes in target repo worktrees
│   ├── perIssueScenarioSweep.ts  # Cron probe: deletes features/per-issue/feature-{N}.feature 14 days after the issue's PR merges
│   ├── cronProcessGuard.ts  # Duplicate cron process prevention
│   ├── cronRepoResolver.ts  # Cron repo identity resolution (testable, extracted from trigger_cron)
│   ├── cronStageResolver.ts  # Cron stage resolution from top-level state file (testable)
│   ├── issueDependencies.ts
│   ├── issueEligibility.ts
│   ├── issueOpenedRouter.ts  # Pure routing decision + DI orchestration for the issues.opened label-routing path
│   ├── mergeDispatchGate.ts  # Lock-aware gate deciding whether cron should dispatch adwMerge for an issue
│   ├── pauseQueueScanner.ts  # Cron probe for paused issue queue
│   ├── scanAuthQueue.ts  # Cron probe: resumes paused_auth orchestrators after auth is restored
│   ├── spawnGate.ts  # Per-issue filesystem lock preventing duplicate orchestrator launches
│   ├── takeoverHandler.ts  # Candidate decision tree: evaluateCandidate composes spawnGate, processLiveness, agentState, remoteReconcile, and worktreeReset
│   ├── trigger_cron.ts
│   ├── trigger_shutdown.ts  # Graceful shutdown handler
│   ├── trigger_webhook.ts
│   ├── webhookGatekeeper.ts
│   ├── webhookHandlers.ts
│   └── webhookSignature.ts
├── r2/                 # Cloudflare R2 upload module
│   ├── bucketManager.ts  # R2 bucket creation and lifecycle rules
│   ├── r2Client.ts     # R2 client factory
│   ├── types.ts        # R2 type definitions
│   ├── uploadService.ts  # File upload logic
│   └── index.ts
├── promotion/          # Scenario promotion scoring and mover module
│   ├── __tests__/      # Vitest unit tests
│   ├── index.ts        # runPromotionCommenter entry point
│   ├── promotionApprovalDetector.ts  # Detects bare @promotion approval signals in .feature files
│   ├── promotionCommenter.ts  # Orchestrates parse → score → tag → comment
│   ├── promotionMover.ts      # Moves approved scenarios from per-issue to regression directory
│   ├── promotionScorer.ts     # Scores scenarios against the vocabulary registry
│   ├── promotionTagWriter.ts  # Inserts @promotion-suggested-<date> tags
│   ├── promotionStatsLoader.ts  # Loads and aggregates historical promotion statistics
│   ├── promotionThreshold.ts  # Computes promotion threshold from historical stats
│   ├── scenarioParser.ts      # Parses Gherkin .feature files into Scenario objects
│   ├── vocabularyParser.ts    # Parses features/regression/vocabulary.md into VocabularyRegistry
│   └── types.ts        # Shared types (VocabularyEntry, ScoreResult, PromotionStats, etc.)
├── known_issues.md     # Known issues and workarounds
├── adwBuild.tsx        # Orchestrators (individual & combined)
├── adwChore.tsx        # Chore pipeline with LLM diff gate (auto-merge)
├── adwMerge.tsx        # Merge orchestrator (awaiting_merge handoff)
├── adwPromotionSweep.tsx  # Promotion sweep orchestrator (score per-issue scenarios, suggest @regression promotions; detect and move @promotion-approved scenarios via PR)
├── adwUpgrade.tsx         # Framework upgrade orchestrator (regenerates .adw/ config in target repos via versioned hash claim)
├── adwBuildHelpers.ts
├── adwClearComments.tsx
├── adwDocument.tsx
├── adwInit.tsx
├── adwPatch.tsx
├── adwPlan.tsx
├── adwPlanBuild.tsx
├── adwPlanBuildDocument.tsx
├── adwPlanBuildReview.tsx
├── adwPlanBuildTest.tsx
├── adwPlanBuildTestReview.tsx
├── adwPrReview.tsx
├── adwSdlc.tsx
├── adwTest.tsx
├── healthCheck.tsx     # Health check orchestrator
├── healthCheckChecks.ts
├── workflowPhases.ts   # Workflow phase re-exports
├── index.ts
├── tsconfig.json
└── README.md
.github/
└── workflows/
    ├── deploy-workers.yml  # Auto-deploy Cloudflare Workers on push to main
    └── regression.yml      # Periodic @regression BDD scenario runner
workers/                # Cloudflare Workers
├── cost-api/           # Cost data ingestion API (costs.paysdoc.nl, D1-backed)
│   ├── src/
│   │   ├── auth.ts         # Bearer token authentication
│   │   ├── cors.ts         # CORS middleware
│   │   ├── index.ts        # Worker entry point
│   │   ├── ingest.ts       # POST /api/cost handler
│   │   ├── migrations/     # D1 SQL migrations
│   │   ├── queries.ts      # D1 query helpers
│   │   ├── schema.sql      # D1 database schema
│   │   └── types.ts        # Worker type definitions
│   ├── test/
│   │   ├── cors.test.ts    # CORS middleware tests
│   │   ├── ingest.test.ts  # Ingest endpoint tests
│   │   └── queries.test.ts # D1 query tests
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── wrangler.toml       # Cloudflare Workers config
└── screenshot-router/  # Screenshot URL routing worker
    ├── src/
    │   └── index.ts    # Worker entry point
    ├── package.json
    ├── tsconfig.json
    └── wrangler.toml   # Cloudflare Workers config
test/                   # Integration test infrastructure
├── fixtures/           # Static test fixtures
│   ├── cli-tool/       # Fixture target repo for BDD scenario testing
│   │   ├── .adw/       # ADW config for fixture repo
│   │   ├── src/        # Minimal CLI tool source
│   │   ├── README.md
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── github/         # GitHub API response fixtures (issue, PR, comments)
│   ├── jsonl/          # JSONL fixture files for testing
│   └── scenarios/      # Gherkin .feature fixtures for promotion scoring tests
│       ├── envelopes/
│       ├── manifests/  # Named scenario manifests for stub sequencing
│       └── payloads/
├── mocks/              # Mock implementations
│   ├── __tests__/      # Vitest unit tests for mock infrastructure
│   │   └── manifestInterpreter.test.ts
│   ├── claude-cli-stub.ts      # Claude CLI process stub
│   ├── git-remote-mock.ts      # Git remote mock
│   ├── github-api-server.ts    # GitHub API mock HTTP server
│   ├── manifestInterpreter.ts  # JSONL manifest interpreter for stub sequencing
│   ├── test-harness.ts         # Test harness orchestrating all mocks
│   └── types.ts                # Mock type definitions
├── Dockerfile          # Generic Docker image for isolated @regression runs
├── docker-run.sh       # Helper script to run scenarios inside Docker
├── tsconfig.json       # TypeScript config for test infrastructure
└── .dockerignore       # Files excluded from Docker build context
app_docs/               # Generated feature documentation
bun.lock                # Bun lockfile
eslint.config.js        # ESLint configuration
cucumber.js             # Cucumber.js configuration
features/               # BDD feature files (Gherkin .feature)
├── per-issue/          # Per-issue agent-input scenarios — never executed by the runner; swept 14 days after PR merges
│   └── step_definitions/  # Per-issue step definition files
├── regression/         # Regression scenario vocabulary, typed World, and surface/smoke scenarios
│   ├── smoke/          # High-level smoke scenarios (cron spawn, SDLC, cancel, chore, pause)
│   ├── step_definitions/  # Typed Given/When/Then steps and RegressionWorld for regression scenarios
│   ├── support/        # Cucumber hooks for @regression suite
│   ├── surfaces/       # Per-phase surface scenarios (row-01 through row-35 covering every orchestrator phase)
│   └── vocabulary.md   # Canonical BDD phrase registry with rot-detection rubric for @regression authoring
├── step_definitions/   # Top-level step definitions (webhook integration scenario)
├── support/            # Top-level Cucumber support (tsx registration)
└── webhook_ensure_cron_on_every_event.feature  # Integration scenario: cron fires on every webhook event (issue #501)
specs/                  # Generated implementation specs
├── patch/              # Generated patch specs
└── prd/                # Product requirement documents
.env.sample             # Environment variable template
.gitignore
package.json
tsconfig.json           # Root TypeScript configuration
vitest.config.ts        # Vitest test configuration
known_issues.md         # Production incidents, recurring failure patterns, and resolution status
README.md               # This file
UBIQUITOUS_LANGUAGE.md  # DDD ubiquitous language glossary
```
