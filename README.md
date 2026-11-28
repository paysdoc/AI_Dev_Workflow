# AI Dev Workflow (ADW)

ADW is an agentic SDLC framework: it turns issues on GitHub, GitLab, or Jira into reviewed, tested, and documented pull requests by orchestrating Claude Code agents through a configurable plan → build → test → review → document pipeline.

## What it does

- **SDLC orchestrators** — `adwSdlc` runs baseline → install → plan ∥ scenarios → plan/scenario alignment → build → unit tests → scenario fix loop → review → document → PR → proof publish for one issue, handing merge to `adwMerge`; `adwPlanBuild*`, `adwChore`, `adwPatch` and the single-phase scripts (`adwPlan`, `adwBuild`, `adwTest`, `adwPrReview`, `adwDocument`) compose subsets.
- **Issue classification and routing** — an LLM classifies each issue as `/chore`, `/bug`, `/feature` or `/pr_review` and routes it to the matching orchestrator; `adw:*` labels override the classifier.
- **Cron and webhook triggers** — `trigger_cron.ts` polls every 20 s and `trigger_webhook.ts` takes HMAC-signed GitHub webhooks (optional Cloudflare tunnel), each event isolated so one failure cannot crash the trigger.
- **Dependency-aware scheduling** — an LLM extracts `blocked by` dependencies, deferred issues are unblocked when their blocker closes, and a per-repo concurrency cap and region-overlap check limit parallel work.
- **Plan-then-build pipeline** — plans live only in the issue's worktree; the build agent works through them with a novelty progress gate that stops builds that loop or make no progress.
- **BDD scenario validation** — per-issue `@adw-{N}` scenarios are written alongside the plan, aligned with it, driven red-to-green by the build agent (which writes the step definitions), then frozen during the scenario fix loop and re-checked against the issue for fidelity; a boundary-tag gate fails any scenario whose `@boundary-<name>` tag is missing or names no Real Boundary declared in `.adw/scenarios.md`.
- **Machine gates before review** — type checks, lint, build, unit tests and `@regression`/per-issue scenarios must pass first; fix loops reject suppression comments and weakened check configuration.
- **Baseline gate** — the base branch is checked and its dev server started first; a red base or a pre-existing regression parks the workflow instead of handing it to the fix agent.
- **Application-type-driven evidence** — `cli`, `web` (ADW-owned Playwright project) or `mobile:kotlincm` (per-workflow Android emulator and iOS simulator) decides how scenarios run and what proof is collected.
- **Passive review with auto-patching** — the reviewer judges scope, scenario fidelity, proof images and coding guidelines; blockers are auto-patched (`patchAgent`/`refactorAgent`) up to a retry cap, then the workflow ends as `review_failed`.
- **Chore fast-path diff gate** — `adwChore` lets Haiku classify the diff as `safe` (auto-merge) or `regression_possible` (full review).
- **HITL-gated auto-merge** — `adwMerge` merges when `(no hitl label) OR (PR approved)`, after merging the base branch in (resolving conflicts) and re-running the scenarios on the result.
- **Operator directives** — `## Retry`, `## Continue` (waive a base-branch park) and `## Cancel` (scorched-earth reset) comments steer parked, failed or stuck workflows.
- **Documentation generation** — `documentAgent` writes feature docs to `app_docs/`; a CI gate and a daily sweep keep the `.adw/conditional_docs.md` index healthy.
- **Scenario lifecycle sweep** — per-issue scenarios are removed 14 days after merge behind a static-check gate, from the per-issue and step-definition directories `.adw/scenarios.md` names; a step-definition file a remaining scenario still uses is kept, and for cucumber-js, cucumber-jvm and playwright-bdd the sweep files one `adw:chore` issue listing the step definitions that no feature file uses; for cucumber-jvm and playwright-bdd, the definitions a sweep's own removal leaves unused are listed by the next sweep.
- **Multi-provider support** — `IssueTracker`/`CodeHost` ports from `@paysdoc/devplatform` back GitHub, GitLab and Jira issue trackers and GitHub/GitLab code hosts, plus GitHub Projects V2 board automation.
- **Resilience primitives** — worktree isolation, per-issue spawn locks, PID liveness and heartbeats, takeover with worktree reuse probing, hung-orchestrator detection, dev-server and device janitors, and remote stage reconciliation.
- **Rate-limit and auth recovery** — in-process waits for known reset times, a per-repo pause queue with automatic resume, and a `paused_auth` queue with Slack alerts.
- **Cost tracking and reporting** — per-phase, per-model token costs with multi-currency output, CLI-cost divergence detection and persistence to a Cloudflare D1 Cost API.
- **Framework self-upgrade** — a hash gate detects a stale `.adw/` in a target repo and regenerates it through an `adwUpgrade` PR, with bounded redrive of failed upgrades.
- **Target-repo bootstrap and guardrails** — `/adw_init` writes `.adw/` config, runs `depaudit` supply-chain setup and propagates secrets; every target-repo agent runs with an injected deny list and hooks and with auto-memory disabled.
- **CI guards** — lint scripts block direct `git`/`gh` shell-outs, hard-coded branch names and model literals; a JSONL conformance check catches Claude CLI stream-format drift.
- **Screenshot hosting** — review and proof screenshots are uploaded to Cloudflare R2 and served through the `screenshot-router` Worker.
- **Operator tooling** — `healthCheck.tsx` validates environment, git and Claude CLI, and `adwClearComments.tsx` resets an issue's comments.

*Built solo over roughly two months as a way to think seriously about how AI-assisted software systems should be designed, governed, and verified. Self-hosting from week one. The decisions and failure modes below are the substance of what I learned.*

---

## About this project

ADW began as an extension of the foundational orchestration patterns from IndyDevDan's [Agentic Engineer course](https://agenticengineer.com/) and grew over roughly 2,900 commits and 460 merged PRs into a production-shaped framework safe to run unattended against real repositories. It has been self-hosting since the first week — the project's own commits are produced by ADW driving its own implementation, with subjects prefixed `plan-orchestrator:`, `build-agent:`, `alignment-agent:`, `review-patch-agent:`, and so on. Running ADW against its own repository from the first week is where most of the design decisions came from — failures hit fast and had to be fixed before the next session.

The most valuable artifact in this repository isn't the framework. It's the trail of failure modes that reshaped it, and the design decisions that came out of those failures. Most of what I learned about agentic systems came from operating one, not from reading about them.

The sections that follow are the load-bearing parts: the design decisions that turned out to matter, the failure patterns that recurred until I rebuilt the underlying primitive, and the boundaries I deliberately chose not to cross. The operator documentation — setup, configuration, usage — sits below the break.

## Key design decisions

These are the load-bearing choices. Each one was validated by an incident or a repeated failure mode rather than by upfront design.

**Worktree-per-issue, not branch-switching.** Every workflow runs in its own `.worktrees/{branch}/` directory. Concurrent issues mean concurrent worktrees. The cost is disk usage and the complexity of `worktreeReset`. The benefit is zero branch-state contamination, trivially safe parallel runs, and a stuck workflow that can be reclaimed by resetting *its* worktree without touching others.

**Single-host constraint, no clustering.** Cron and webhook triggers are explicitly host-local. The orchestrator-coordination PRD makes this a deployment convention, not a code-level guarantee. The rationale is that cross-host distributed locking adds complexity disproportionate to the benefit — one team, one repo, one host suffices. The escape hatch is `## Cancel`, which performs scorched-earth cleanup on the host that processes it first.

**Stateless auto-merge gate.** The rule is `gate_open = (no hitl on issue) OR (PR is approved)`, re-evaluated on every cron tick rather than cached from workflow start. Human gating becomes a real-time decision: add `hitl` before the PR opens to defer merge, remove it later to re-enable. Any cached state was a source of "why didn't it merge?" support load; the stateless rule is trivially auditable.

**BDD scenarios as the plan/implementation contract.** Scenarios are not just tests — they are the validation surface that catches plan-implementation drift. `validationAgent` and `resolutionAgent` enforce alignment with the issue body. Per-issue scenarios (run only by their own workflow's test phase, by `@adw-{N}` tag) were split from regression scenarios (the standing suite) because mixing them caused the runner to fail on draft scenarios and produced ambiguous "is this regression?" decisions.

**LLM diff gate for chores.** Chores skip review and document by default but only auto-merge if Haiku classifies the diff as `safe`. `regression_possible` falls through to the full review path; classifier failure defaults to `regression_possible` (fail-safe). Chore volume is high and full review on every CSS tweak is wasteful, but unguarded auto-merge once produced a regression that triggered this design.

**Cost persisted in D1, not in git.** Cost tracking originally lived as CSV files committed by ADW into the target repo's git history. This produced a year's worth of merge and rebase bugs in two months (see failure modes below). The eventual fix was not another patch but a model change: cost records are posted to a Cloudflare D1-backed Worker, decoupling cost from the target repo's git history. CSV and D1 were written side by side during the rollout; the CSV writer has since been removed.

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

The eventual fix was not another patch. It was a data-model change: cost records go to a Cloudflare D1-backed Worker, decoupling cost from target-repo git history.

**Lesson:** when fixes pile up against the same module faster than they stick, the data model is wrong.

### State-file overwrite races

`completeWorkflow` was overwriting an `awaiting_merge` stage that had been set later by a different code path. The fix surface ran across April 3rd to April 20th, ending in a formalized stage taxonomy: `discarded` introduced as a terminal state, separate from `abandoned`, and the top-level state schema extended with `pid`, `pidStartedAt`, and `lastSeenAt` fields.

**Lesson:** implicit state machines drift over time. Making them explicit prevents the next race.

### GitHub Project Board flakiness

Board V2 GraphQL operations failed for auth (the default `gh` token works for most things, but project boards require a PAT), lost column order and option IDs on update, and miscolored status options. The fix landed first as scattered patches across April 16th to April 18th, then as a consolidation: a `withProjectBoardAuth` wrapper covering every board operation site.

**Lesson:** when an external API has a non-obvious auth contract, codify it in a single chokepoint *before* every call site grows its own copy.

### Rate limit and token limit detection

False positives on token limits, missing detection of 529 overloaded errors, output tokens not displayed. The fix was twofold: structured JSONL parsing (`claudeStreamParser.ts`) replaced regex against stdout, and an explicit pause and resume queue (`pauseQueue.ts` with `pauseQueueScanner.ts`) replaced ad-hoc retry. A `five_hour` limit with a known reset time is now ridden out in-process by the phase runner (`rateLimitWaitPolicy.ts`, `phaseRunner.ts`) instead of exiting to that queue; everything else — a `seven_day` limit, an unknown limit type, or any limit with no reported reset time — still goes through it.

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
5. `@paysdoc/devplatform/providers` (`forgeProviders()`) together with `@paysdoc/devplatform`'s port types — the provider abstraction, now supplied by the library rather than in-tree; `adws/core/launchGitContext.ts` calls `forgeProviders()` to assemble the same provider triple at the launch boundary, bound to the same identity as the GitContext.
6. [UBIQUITOUS_LANGUAGE.md](UBIQUITOUS_LANGUAGE.md) — domain terms (Workflow, Phase, Stage, Orchestrator, Worktree, Spawn Lock, Takeover, etc.). Worth reading before any unfamiliar phase.
7. [docs/prd/orchestrator-coordination-resilience.md](docs/prd/orchestrator-coordination-resilience.md) — the design rationale for the coordination kernel.
8. [docs/adr/README.md](docs/adr/README.md) — one record per design decision, including the ones that were replaced, each with its sources.

---

## Operator documentation

Everything below is for someone who wants to run ADW against a target repository. The framing above is for someone evaluating the codebase or its author.

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
| [Node.js](https://nodejs.org/) (>= 18) | Runtime for ADW scripts (launched as `bunx tsx`) and for the Claude Code CLI | `brew install node` | `sudo apt install nodejs` |
| [Git](https://git-scm.com/) | Version control, worktrees, branching | `brew install git` | `sudo apt install git` |
| [Bun](https://bun.sh/) | Package manager and script launcher | `brew install oven-sh/bun/bun` | `curl -fsSL https://bun.sh/install \| bash` |
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

ADW runs on your Claude subscription by default; no Anthropic API key is needed.

Required and optional environment variables (see `.env.sample` for full reference):
- `GITHUB_REPO_URL` - Your GitHub repository URL
- `ANTHROPIC_API_KEY` - (Optional) Anthropic API key. Leave it unset to run on your Claude subscription (log in once with `claude auth login`); setting it moves billing for every agent ADW starts from the subscription to the Anthropic API.
- `CLAUDE_CODE_PATH` - (Optional) Path to Claude CLI, defaults to `claude`
- `GITHUB_PAT` - (Optional) GitHub personal access token, only needed if using a different account than `gh auth login`. Use a classic PAT with the `project` scope for Projects V2 board automation — fine-grained `github_pat_...` tokens are unreliable against Projects V2 GraphQL on user-owned boards. **Migration note:** the legacy `GITHUB_PERSONAL_ACCESS_TOKEN` alias is no longer read; operators must set `GITHUB_PAT`.
- `GITHUB_APP_ID` - (Optional) GitHub App ID for app-based authentication (comments appear as the app)
- `GITHUB_APP_SLUG` - (Optional) GitHub App slug, used with `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY_PATH` - (Optional) Path to GitHub App private key PEM file
- `GITHUB_WEBHOOK_SECRET` - (Optional) Required only for webhook trigger
- `TARGET_REPOS_DIR` - (Optional) Directory for storing cloned target repository workspaces, defaults to `~/.adw/repos`
- `MAX_CONCURRENT_PER_REPO` - (Optional) Maximum concurrent in-progress issues per repository, defaults to `5`
- `MAX_FAILURES` - (Optional) Max upgrade-lane regeneration failures before escalating to a human, defaults to `3`
- `RUNNING_TOKENS` - (Optional) Show running token totals in issue comments, defaults to `false`
- `SHOW_COST_IN_COMMENTS` - (Optional) Show cost breakdowns in GitHub issue/PR comments, defaults to `false`
- `JIRA_BASE_URL` - (Optional) Jira instance URL, required only when using Jira as the issue tracker
- `JIRA_PROJECT_KEY` - (Optional) Default Jira project key
- `JIRA_EMAIL` - (Optional) Jira Cloud auth email; read by `adws/core/forgeWiring.ts`'s wiring, never by the adapter (#818; relocated from `repoContext.ts` in #823)
- `JIRA_API_TOKEN` - (Optional) Jira Cloud API token; read by `adws/core/forgeWiring.ts`'s wiring, never by the adapter (#818; relocated from `repoContext.ts` in #823)
- `JIRA_PAT` - (Optional) Jira Data Center/Server personal access token (use instead of email + API token); read by `adws/core/forgeWiring.ts`'s wiring, never by the adapter (#818; relocated from `repoContext.ts` in #823)
- `GITLAB_TOKEN` - (Optional) GitLab personal access token (needs api scope), required only when using GitLab; read by `adws/core/forgeWiring.ts`'s wiring, never by the adapter (#818; relocated from `repoContext.ts` in #823)
- `GITLAB_INSTANCE_URL` - (Optional) GitLab instance URL, defaults to `https://gitlab.com`; read by `adws/core/forgeWiring.ts`'s wiring, never by the adapter (#818; relocated from `repoContext.ts` in #823)
- `CLOUDFLARE_ACCOUNT_ID` - (Optional) Cloudflare account ID, required only for screenshot upload functionality
- `R2_ACCESS_KEY_ID` - (Optional) R2 access key ID, required only for screenshot upload functionality
- `R2_SECRET_ACCESS_KEY` - (Optional) R2 secret access key, required only for screenshot upload functionality
- `COST_API_URL` - (Optional) Cost API Worker URL for D1 cost database writes (e.g., `https://costs.paysdoc.nl`)
- `COST_API_TOKEN` - (Optional) Bearer token for Cost API authentication
- `SLACK_WEBHOOK_URL` - (Optional) Slack Incoming Webhook URL for error/problem reporting. Propagated by `adw_init` to each target repo's GitHub Actions secrets via `gh secret set`. Missing values are logged as warnings and do not fail init.
- `SOCKET_API_TOKEN` - (Optional) Socket.dev API token for supply-chain scanning (required only for depaudit). Propagated by `adw_init` to each target repo's GitHub Actions secrets via `gh secret set`. Missing values are logged as warnings and do not fail init.

### 4. Bootstrap a target repo with `/adw_init`

`adw_init` initializes a target repository with `.adw/` configuration and supply-chain tooling.

**Automatic regeneration:** once a target repo is bootstrapped, the hash-driven `adwUpgrade.tsx` trigger automatically regenerates `.adw/` whenever the ADW framework hash drifts — no manual intervention needed.

**Manual escape hatch:** to bootstrap or force-reinitialise a target repo, invoke the `/adw_init` slash command inside a Claude Code CLI session opened against that repo:

```
/adw_init
```

During init, `adw_init` runs `depaudit setup` in the target repo worktree (requires `npm install -g depaudit` on the ADW host) and propagates `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` to the target repo's GitHub Actions secrets via `gh secret set`. If either env var is missing, a warning is logged and `adw_init` continues.

`adw_init` detects the application type (`cli` or `web`) and writes `## Application Type` to `.adw/project.md`. `mobile:kotlincm` is set by hand only: `adw_init` never detects it, and preserves it. When it cannot decide, it leaves the section out, and ADW parks the repository's issues until the section is added by hand or `adw_init` is re-run. A value set by hand survives regeneration.

`adw_init` also writes the repository's Real Boundaries under `## Real Boundaries` in `.adw/scenarios.md`, from the application type: a `cli` repository gets `cli`, `http` or `package` for each of a command-line tool, an HTTP service and a library that it is; a `web` repository gets `browser`, and `http` too when it serves an HTTP API besides its pages; a `mobile:kotlincm` repository gets `app`. A list the repository already has is kept as it is, so that an upgrade never resets it, and when the type is undecided the section is left out for the scenario agent to create. `adw_init` copies `templates/vocabulary.md.template` to `features/regression/vocabulary.md` only when the repository has no registry yet; the template describes execution at a Real Boundary, lists no in-process execution pattern and states that the vocabulary binds the Regression Suite only.

When the type is `mobile:kotlincm`, `adw_init` then writes the descriptors the repository's own `:scenarios` Gradle module needs, even before the repository has a manifest: a Gradle unit-test command (every module's `test` task except `:scenarios:test`, its JUnit reports gathered into `$ADW_UNIT_TEST_REPORT_PATH`) and a Gradle build command (`./gradlew build -x test`, which passes with a note while the repository has no Gradle build yet, so that the bootstrap issue's baseline is green), `N/A` for the dev server, `cucumber-jvm` with Kotlin step definitions under `scenarios/src/test/kotlin`, run-by-tag and regression commands for `:scenarios` with a cucumber tag filter, the four device-source sections of `.adw/project.md` (`## Android System Image`, `## Android Device Profile`, `## iOS Device Type`, `## iOS Runtime`: defaults when absent, kept when set) and a `## Scenario Run Contract` in `.adw/scenarios.md` (the device variables, the `cucumber.*` system properties the `:scenarios` test task passes on to cucumber-jvm, among them the dry-run properties of the Per-Issue Sweep, the JUnit attachment lines and the `android/` and `ios/` screenshot directories). For this type a `## Run Tests` that holds only `N/A` is replaced; any other existing command is kept.

For a `web` repository, `adw_init` also installs ADW's Playwright project in `features/`, even when the application is not a Node application: `features/playwright.config.ts` from `templates/playwright/`, `features/package.json` (created only when absent), `features/.gitignore` (which keeps `node_modules/` and the generated tests out of git), `npm install` and the browser install. The configuration is byte-identical in every `web` repository and reads the repository's values only from `ADW_APPLICATION_URL`, `ADW_PROOF_DIR` and `ADW_JUNIT_REPORT_PATH`; every upgrade overwrites it, and the upgrade installs the project itself after the `/adw_init` agent, so the regen commit carries `features/package-lock.json`. An existing e2e setup elsewhere in the repository (its own Playwright, Cypress or Cucumber configuration, tests and dependencies) is left as it is, and ADW does not use it. ADW no longer reads `.adw/review_proof.md`, so a repository that still has one can delete it.

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
| `features/regression/` | Promoted regression suite — run by the `@regression` tag. |
| `features/per-issue/` | Per-issue scenarios — run only by their own workflow's test phase (by `@adw-{N}` tag), never as part of the regression run; retained for 14 days after the issue's PR merges and then swept by the cron probe, which reads the per-issue and step-definition directories `.adw/scenarios.md` names, keeps a step-definition file a remaining scenario still uses, and for cucumber-js, cucumber-jvm and playwright-bdd files one `adw:chore` issue listing the step definitions that no feature file uses; for cucumber-jvm and playwright-bdd, the definitions a sweep's own removal leaves unused are listed by the next sweep. File naming: `feature-{issueNumber}.feature`. |

Top-level `features/*.feature` files were removed in the BDD cutover (issue #493). All promoted scenarios now live exclusively under `features/regression/`.

### `.adw/scenarios.md` optional sections

Three optional sections activate the regression-suite contract. When absent, the `scenario_writer` prompt uses its legacy free-form behaviour.

| Section | Effect when present |
|---|---|
| `## Per-Issue Scenario Directory` | `scenario_writer` routes per-issue output to `<value>/feature-{N}.feature` instead of the fallback directory. |
| `## Regression Scenario Directory` | `scenario_writer` skips the `@regression` auto-promotion sweep (regression promotion becomes a deliberate human decision). |
| `## Vocabulary Registry` | Names the phrase registry of the regression suite. Per-issue scenarios are phrased freely (ADR-0067). |

### Scenario Promotion

Promoting a per-issue scenario into `features/regression/` is a deliberate human decision. The scoring promotion sweep, with its threshold ramp, its `@promotion-suggested-<date>` tag and its rot/reuse advisory comment on promotion PRs, was removed under [ADR-0068](docs/adr/0068-promotion-by-nomination-and-human-decided-proposal.md). A per-issue scenario that still carries an old suggestion tag is swept on the normal 14-day rule. The scenario agent may nominate at most one scenario it creates per issue with the `@nominated` tag (`@nomination-declined` marks one the owner declined, never nominated again), and `adws/promotion/nominationCollector.ts` collects the Nominations of merged issues from the default branch. The Promotion Proposal that the owner decides comes in a later slice; until then a nominated scenario is swept like any other. An issue labelled `regression-promotion` still skips the scenario-writing phase.

### Running BDD scenarios on the host

```bash
# Run all @regression scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Run a specific tag
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@mock-infrastructure"

# Run the subprocess surface rows: real ADW processes behind the hermetic subprocess harness
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface and @subprocess"
```

### Docker (optional)

A generic Docker image (`test/Dockerfile`) provides an isolated runtime (Bun + Git) so
the full `@regression` suite can run inside a container without host-specific dependencies.
The image is generic — no ADW source code is baked in. The repo is mounted read-only at
`/workspace` and is never written. The container copies it with `cp -R` into
`/tmp/bdd/workspace`, then installs dependencies and runs the suite there, because ADW writes
its runtime state (`agents/`, `logs/`) under the working directory. An anonymous volume over
`/workspace/node_modules` keeps the host's `node_modules` out of the copy.
`TEST_RUNTIME=docker` is set automatically inside the container.

Every container run leaves out the scenarios tagged `@host-only`, whatever `--tags` it is given:
they install ADW's Playwright project from the npm registry with the real `npm` and `npx` and drive
a real Chromium, which the image (Bun and Git only) cannot, so they run on the host only.

```bash
# Build the image once (again after any change to test/Dockerfile)
bun run test:docker:build

# Run @regression scenarios inside the container (same results as host, less the @host-only scenarios)
bun run test:docker

# Run a specific tag inside the container
bash test/docker-run.sh --tags "@mock-infrastructure"

# Open an interactive shell for debugging (in the read-only /workspace; no copy is made)
bash test/docker-run.sh --shell
```

The daily `Regression Scenarios` workflow (`.github/workflows/regression.yml`) runs the suite in
two jobs, `host` and `docker`. A manual dispatch runs the job its `runtime` input names. Each
job fails when a scenario fails, is pending or is undefined.

Docker execution is entirely optional — the test suite runs identically on the host without it.

## Project Structure

```
.adw/                   # Project configuration for ADW (see adws/README.md)
├── coding_guidelines.md # Coding guidelines (fallback: guidelines/coding_guidelines.md for older repos)
├── commands.md         # Build/test/lint command mappings
├── conditional_docs.md # Conditional documentation paths
├── project.md          # Project structure and relevant files
├── providers.md        # Provider configuration (issue tracker, code host)
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
│   ├── correct_output.md
│   ├── document.md
│   ├── extract_dependencies.md
│   ├── feature.md
│   ├── find_issue_dependencies.md
│   ├── generate_branch_name.md
│   ├── implement.md
│   ├── install.md
│   ├── patch.md
│   ├── pr_review.md
│   ├── prime.md
│   ├── promote_regression_vocabulary.md
│   ├── pull_request.md
│   ├── resolve_conflict.md
│   ├── resolve_failed_scenario.md
│   ├── resolve_failed_test.md
│   ├── resolve_plan_scenarios.md
│   ├── review.md
│   ├── scenario_writer.md
│   ├── test.md
│   ├── tools.md
│   ├── validate_plan_scenarios.md
│   └── validate_scenario_fidelity.md
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
│   ├── domain-modeling/
│   │   ├── ADR-FORMAT.md
│   │   ├── GLOSSARY-FORMAT.md
│   │   ├── agents/
│   │   │   └── openai.yaml
│   │   └── SKILL.md
│   ├── grill-me/
│   │   ├── agents/
│   │   │   └── openai.yaml
│   │   └── SKILL.md
│   ├── grill-with-docs/
│   │   ├── agents/
│   │   │   └── openai.yaml
│   │   └── SKILL.md
│   ├── grilling/
│   │   ├── agents/
│   │   │   └── openai.yaml
│   │   └── SKILL.md
│   ├── improve-codebase-architecture/
│   │   ├── REFERENCE.md
│   │   └── SKILL.md
│   ├── pr-lens/
│   │   └── SKILL.md
│   ├── prd-to-issues/
│   │   └── SKILL.md
│   ├── promote-regression-vocabulary/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── list-registered-phrases.ts
│   ├── refactor/
│   │   └── SKILL.md
│   ├── implement-tdd/
│   │   ├── SKILL.md
│   │   ├── deep-modules.md
│   │   ├── interface-design.md
│   │   ├── mocking.md
│   │   ├── step-definitions.md
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
│   ├── write-a-skill/
│   │   └── SKILL.md
│   └── write-an-adr/
│       ├── SKILL.md
│       └── TEMPLATE.md
└── settings.json
templates/              # ADW framework-level templates
├── claude-settings-starter.json  # Canonical deny-list source for the guardrails `--settings` injection; also copied into target repos by `/adw_init`
├── playwright/         # Seed files for a web target repo's ADW-owned Playwright project
│   ├── gitignore.template
│   ├── package.json.template
│   └── playwright.config.ts.template
└── vocabulary.md.template  # Seed template for target-repo regression vocabulary registries
adws/                   # ADW workflow system (GitContext and the forge provider layer — formerly adws/gitContext/ and adws/providers/ — now come from the `@paysdoc/devplatform` npm package, issue #840)
├── __tests__/          # Vitest integration tests
│   ├── adwChore.devServer.test.ts
│   ├── adwChore.helpers.ts  # Shared helpers for the adwChore tests
│   ├── adwChore.test.ts
│   ├── adwInitPrompt.helpers.ts  # Shared helpers for the adw_init prompt tests
│   ├── adwInitPrompt.boundaries.test.ts
│   ├── adwInitPrompt.mobile.test.ts
│   ├── adwInitPrompt.test.ts
│   ├── adwMerge.failedMerge.test.ts
│   ├── adwMerge.gates.test.ts
│   ├── adwMerge.helpers.ts  # Shared helpers for the adwMerge tests
│   ├── adwMerge.postMergeRed.test.ts
│   ├── adwMerge.startMergeLog.test.ts
│   ├── adwMerge.test.ts
│   ├── adwPlanBuildReview.test.ts
│   ├── adwPlanBuildTest.test.ts
│   ├── adwPlanBuildTestReview.test.ts
│   ├── adwUpgrade.test.ts
│   ├── buildPromptsScope.test.ts
│   ├── checkBranchNames.test.ts
│   ├── checkGitGhGuard.test.ts
│   ├── checkLivingDocsIndex.test.ts
│   ├── checkModelLiterals.test.ts
│   ├── depauditSetup.test.ts
│   ├── depauditTriageSkill.test.ts
│   ├── deployWorkersWorkflow.test.ts
│   ├── envelopeConformanceWorkflow.test.ts
│   ├── healthCheckChecks.test.ts
│   ├── implementTddPrompt.test.ts
│   ├── issueDependencies.test.ts
│   ├── planningCommandsPrompt.test.ts
│   ├── prTemplateMarker.test.ts
│   ├── pullRequestPrompt.test.ts
│   ├── regressionWorkflow.test.ts
│   ├── resolveFailedScenarioPrompt.test.ts
│   ├── reviewPrompt.helpers.ts  # Shared helpers for the reviewPrompt tests
│   ├── reviewPrompt.scenarios.test.ts
│   ├── reviewPrompt.test.ts
│   ├── scenarioWriterPrompt.test.ts
│   ├── triggerWebhook.test.ts
│   ├── vocabularyScope.test.ts
│   └── vocabularyTemplate.test.ts
├── agents/             # Claude Code agent runners
│   ├── __tests__/      # Vitest unit tests
│   │   ├── agentProcessHandler.test.ts
│   │   ├── claudeAgent.test.ts
│   │   ├── claudeAgentGuardrails.test.ts
│   │   ├── commandAgent.test.ts
│   │   ├── commitIdentity.integration.test.ts
│   │   ├── documentAgent.test.ts
│   │   ├── gitAgent.test.ts
│   │   ├── refactorAgent.test.ts
│   │   ├── reviewPromptArgs.test.ts
│   │   ├── scenarioFidelityAgent.test.ts
│   │   ├── testAgent.test.ts
│   │   └── testRetry.test.ts
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
│   ├── patchAgent.ts
│   ├── planAgent.ts
│   ├── refactorAgent.ts  # Applies coding-guideline fixes via the /refactor skill (mirrors patchAgent for guideline violations)
│   ├── prAgent.ts
│   ├── resolutionAgent.ts  # Plan-scenario mismatch resolution
│   ├── reviewAgent.ts
│   ├── reviewPromptArgs.ts  # ReviewIssueKind and ReviewPromptContext — the typed arguments the review prompt receives (guidance section, issue kind, scenario image paths)
│   ├── scenarioAgent.ts  # BDD scenario planner agent
│   ├── scenarioFidelityAgent.ts  # Compares frozen scenarios against issue body after resolve
│   ├── testAgent.ts
│   ├── testRetry.ts
│   └── validationAgent.ts  # Plan-scenario validation
├── core/               # Configuration and utilities
│   ├── __tests__/      # Vitest unit tests
│   │   ├── fixtures/
│   │   │   ├── decisionDocs.ts  # Shared module-doc/ADR fixtures for the docs-decisions tests
│   │   │   ├── deviceOutcome.ts  # Reads the outcome of withDevices for a test that expects one kind of it: the result of a ready outcome, or the failure of any other
│   │   │   ├── leftoverDevicesHost.ts  # Recording host that reports emulators and simulators left behind, for the device inventory and janitor tests
│   │   │   ├── docsIndexEntries.ts  # Shared conditional-docs entry fixtures for the docs-index health tests
│   │   │   ├── rateLimitIncident.ts  # Shared fixture data for rate-limit probe/decider tests
│   │   │   ├── recordingClaudeCli.ts  # Recording Claude CLI stand-in for environment/launch tests
│   │   │   └── recordingDeviceHost.ts  # Recording device host for the device lifecycle tests: an executor that answers like a host on which the emulator and the simulator boot, a fake clock and a port probe, changed by a script (a command that fails some times before it succeeds, an emulator that exits early, a program that is not installed)
│   │   ├── adwLabels.test.ts
│   │   ├── adwPlaywrightProject.test.ts
│   │   ├── adwVersion.test.ts
│   │   ├── adwYmlConfig.test.ts
│   │   ├── applicationType.test.ts
│   │   ├── authGate.test.ts
│   │   ├── baselineGate.record.test.ts
│   │   ├── baselineGate.test.ts
│   │   ├── boundaryList.test.ts
│   │   ├── checkRunner.combinedOutput.test.ts
│   │   ├── checkRunner.integration.test.ts
│   │   ├── checkRunner.test.ts
│   │   ├── claudeStreamParser.test.ts
│   │   ├── conditionalDocsRegistry.test.ts
│   │   ├── conditionalDocsRegistryMutations.test.ts
│   │   ├── conditionalDocsRegistryQueries.test.ts
│   │   ├── devServerFailure.test.ts
│   │   ├── devServerLifecycle.healthy.test.ts
│   │   ├── devServerLifecycle.test.ts
│   │   ├── deviceCommands.test.ts
│   │   ├── deviceExecutor.test.ts
│   │   ├── deviceInventory.test.ts
│   │   ├── deviceLifecycle.failures.test.ts
│   │   ├── deviceLifecycle.retries.test.ts
│   │   ├── deviceLifecycle.test.ts
│   │   ├── deviceSourceConfig.test.ts
│   │   ├── docsDecisions.test.ts
│   │   ├── docsDecisionViolations.test.ts
│   │   ├── docsGuards.test.ts
│   │   ├── docsIndexHealth.test.ts
│   │   ├── docsIndexHealthDecisions.test.ts
│   │   ├── docsIndexReportBody.test.ts
│   │   ├── environment.test.ts
│   │   ├── execWithRetry.test.ts
│   │   ├── fixRoundGuard.config.test.ts
│   │   ├── fixRoundGuard.protectedPaths.test.ts
│   │   ├── fixRoundGuard.suppression.test.ts
│   │   ├── fixRoundGuard.table.test.ts
│   │   ├── fixRoundGuard.verdict.test.ts
│   │   ├── fixRoundGuardFixtures.ts  # Shared fixtures for the fix-round guard tests
│   │   ├── forgeWiring.test.ts
│   │   ├── githubAppAuth.test.ts
│   │   ├── guardrailsGate.test.ts
│   │   ├── guardrailsPayload.test.ts
│   │   ├── guardrailsProbe.integration.test.ts
│   │   ├── hashComputer.test.ts
│   │   ├── heartbeat.test.ts
│   │   ├── hungOrchestratorDetector.test.ts
│   │   ├── issueClassifier.test.ts
│   │   ├── issueRecord.test.ts
│   │   ├── launchGitContext.test.ts
│   │   ├── localRepoIdentity.test.ts
│   │   ├── logger.test.ts
│   │   ├── modelRouting.test.ts
│   │   ├── phaseRunner.test.ts
│   │   ├── postMergeVerdict.test.ts
│   │   ├── processLiveness.test.ts
│   │   ├── projectConfig.test.ts
│   │   ├── projectConfigCommands.test.ts
│   │   ├── projectConfigDeviceSource.test.ts
│   │   ├── projectConfigLoad.test.ts
│   │   ├── providerConfig.test.ts
│   │   ├── prReviewInvocation.test.ts
│   │   ├── rateLimitWaitPolicy.test.ts
│   │   ├── regressionTriage.test.ts
│   │   ├── remoteReconcile.test.ts
│   │   ├── repoIdentityCrossCheck.test.ts
│   │   ├── resolveFreezeGuard.test.ts
│   │   ├── resolvePrReviewTarget.test.ts
│   │   ├── resolveResumeSpawn.test.ts
│   │   ├── resolveVerdict.test.ts
│   │   ├── resumePolicy.test.ts
│   │   ├── scenarioRunner.test.ts
│   │   ├── scenarioDirectories.test.ts
│   │   ├── selfHostLaunch.test.ts
│   │   ├── slackNotifier.test.ts
│   │   ├── sshCloneUrl.test.ts
│   │   ├── stackCoherenceCheck.test.ts
│   │   ├── stageClassifier.test.ts
│   │   ├── stateHelpers.test.ts
│   │   ├── staticCheckFixLoop.guard.test.ts
│   │   ├── staticCheckFixLoop.progress.test.ts
│   │   ├── staticCheckFixLoopHelpers.ts  # Shared helpers for the fix-loop tests
│   │   ├── stepDefDetection.test.ts
│   │   ├── targetRepoManager.test.ts
│   │   ├── testReportParser.attachments.test.ts
│   │   ├── testReportParser.incomplete.test.ts
│   │   ├── testReportParser.test.ts
│   │   ├── testVerdict.test.ts
│   │   ├── topLevelState.test.ts
│   │   ├── unaddressedComments.test.ts
│   │   ├── unifiedDiff.parse.test.ts
│   │   ├── unifiedDiff.touchedPaths.test.ts
│   │   ├── unusedStepIssueBody.test.ts
│   │   ├── unusedStepReport.test.ts
│   │   ├── upgradeClaim.integration.test.ts
│   │   ├── upgradeClaim.test.ts
│   │   ├── upgradeFailureCap.test.ts
│   │   ├── workflowCommentParsing.test.ts
│   │   ├── workflowMapping.test.ts
│   │   ├── workspaceBinding.test.ts
│   │   └── workspaceTrust.test.ts
│   ├── adwId.ts        # ADW ID generation
│   ├── adwLabels.ts    # Pure ADW label vocabulary (constants, definitions, readers, predicates)
│   ├── adwPlaywrightProject.ts  # ADW's Playwright project for `web` targets: its setup, install and run-by-tag commands (`ADW_PLAYWRIGHT_*`), the file table (`ADW_PLAYWRIGHT_PROJECT_FILES`: overwrite, create-if-absent, append-missing-lines) and `syncAdwPlaywrightProject`, which writes the files from `templates/playwright/`
│   ├── adwVersion.ts   # Read/write .adw-version file; readRemoteAdwVersion reads from origin/<defaultBranch>:.adw-version (immune to stale local worktrees)
│   ├── adwYmlConfig.ts # Read `.github/adw.yml` from a target repo worktree (upgrade auto-merge policy + unit-test run switch)
│   ├── agentState.ts
│   ├── applicationType.ts  # Pure application-type mapping: type → runner mode, evidence kinds, review guidance section (resolveApplicationType, APPLICATION_TYPE_PROFILES)
│   ├── authGate.ts     # Host-wide auth gate: detects auth failures, writes paused_auth state, triggers Slack alerts
│   ├── baselineGate.ts  # Baseline verdict for a base checkout: installs dependencies, runs the static checks, then the declared dev server → green / checks_red / server_down (runBaselineChecks, declaredDevServerCommand); BaselineRecord (passed / waived, isBaselineWaived)
│   ├── boundaryList.ts  # Pure boundary list: parses the `## Real Boundaries` section of `.adw/scenarios.md` (absent vs declared, malformed entries) and checks that each scenario carries one `@boundary-<name>` tag naming a declared boundary (parseBoundaryList, checkBoundaryTags)
│   ├── checkRunner.ts  # Static-check runner: runs type check, additional type checks, lint and build from .adw/commands.md in fixed order; exit code is the verdict, N/A skipped (runStaticChecks, runShellCommand)
│   ├── claudeStreamParser.ts  # Claude JSONL stream parsing
│   ├── conditionalDocsRegistry.ts  # Parse/serialize/query .adw/conditional_docs.md; ConditionalDocEntry and ConditionalDocsRegistry types; glob-based ownership routing (findOwningEntry)
│   ├── config.ts
│   ├── constants.ts    # Orchestrator ID constants
│   ├── devServerFailure.ts  # Pure: the start of a dev server (not_started / started / failed with its output) and the rules of the review attempt counter (countFailedStart, countStartedServer, countFailedReview, isReviewBudgetSpent)
│   ├── devServerLifecycle.ts  # Dev server spawn, health probe, and cleanup helpers; withHealthyDevServer never runs the work against a server that did not start
│   ├── deviceBringUp.ts  # One attempt to create, boot and await each device (on a console port it probes for), and each device's teardown; it reads a missing host tool from the executor's answer
│   ├── deviceCommands.ts  # Pure: what ADW says to the device tools (the adw-<adwId> names, the console port candidates, the avdmanager, adb, emulator and xcrun simctl commands with their timeouts) and how it reads their answers, including which host tool (HostTool) a missing program or an xcrun without simctl means; MAX_BOOT_ATTEMPTS
│   ├── deviceExecutor.ts  # The process boundary of the device lifecycle: runs avdmanager, emulator, adb and xcrun simctl as argv arrays without a shell (systemDeviceExecutor); it says when a program is not on the PATH, and reads back what a started process printed
│   ├── deviceInventory.ts  # Finds the emulators and simulators named adw-<adwId> on the host and removes one, through the injected executor, for the device janitor sweep
│   ├── deviceLifecycle.ts  # withDevices: creates, boots and hands over one AVD and one simulator named adw-<adwId>, trying each boot three times, and returns ready, boot failed or tool missing, after removing everything it created
│   ├── deviceSourceConfig.ts  # Pure: the four device-source sections of .adw/project.md (parseDeviceSourceSections) and the device source a profile with platforms needs (resolveDeviceSource, DeviceSourceConfigError)
│   ├── docsDecisions.ts  # Module doc ↔ ADR checks: an entry's Decisions: block vs. its doc's ## Decisions section, and records missing from docs/adr/
│   ├── docsGuards.ts  # Post-write guards for app_docs/: bloat detection (line-count ceiling) and regrowth detection (overlapping Owns: globs between entries); runDocsGuards composes both
│   ├── docsIndexHealth.ts  # Migration acceptance gate helpers for conditional_docs.md ↔ app_docs/ bijection health
│   ├── docsIndexReportBody.ts  # Formats docs-index health findings into a report body
│   ├── environment.ts  # Environment variable accessors
│   ├── fixRoundGuard.ts  # Pure guard over a static-check fix round's unified diff: rejects a round that adds a lint/type suppression or edits a protected path (evaluateFixRound, buildFixRoundGuardConfig, describeGuardRejection)
│   ├── fixRoundGuardTable.ts  # Data tables for the guard — framework suppression patterns per language and protected-path rules
│   ├── forgeWiring.ts  # ADW's forge wiring (#823) — gitLabConfigFromEnv/jiraAuthFromEnv/jiraConfigFrom, adwGitHubForgeDeps (Slack ping, label catalogue, approval predicate), buildAdwForgeDeps (the full ForgeProviderDeps a launch boundary needs); moved out of adws/providers/repoContext.ts
│   ├── githubAppAuth.ts  # GITHUB_APP_* env wrapper (isGitHubAppConfigured, getInstallationToken) — moved verbatim from adws/github/githubAppAuth.ts (#820); that path no longer exists, deleted in #823
│   ├── guardrailsGate.ts  # Pure gate deciding whether a target-repo spawn receives the guardrails `--settings` injection (kill switch, self-host, startup probe)
│   ├── guardrailsPayload.ts  # Builds the injected `--settings` JSON: deny list from templates/claude-settings-starter.json + all five framework hooks at absolute paths
│   ├── guardrailsProbe.ts  # Memoized startup probe (subprocess) verifying guardrails injection is safe before use; fails open
│   ├── hashComputer.ts # SHA256 hash of declared hashInputs files — "current framework version" primitive
│   ├── heartbeat.ts    # Liveness ticker writing lastSeenAt to state on a fixed interval
│   ├── hungOrchestratorDetector.ts  # Pure-query detector for wedged orchestrators (live PID + stale heartbeat)
│   ├── index.ts
│   ├── issueClassifier.ts
│   ├── issueRecord.ts  # fetchIssueRecord(ctx, issueNumber) — the full GitHubIssue read over the boundary's own GitContext, kept forge-shaped for prompt fidelity (#820)
│   ├── jsonParser.ts
│   ├── launchGitContext.ts  # Boundary-constructor adapter — buildLaunchBoundary builds one GitContext AND assembles the forge provider triple (IssueTracker/CodeHost/BoardManager) bound to the SAME identity via forgeProviders(), in the same call, per process launch boundary (cron module-scope, adwMerge.main(), initializeWorkflow); providers are assembled lazily on first access and memoised, so building the context alone gains no new I/O or failure mode; buildLaunchGitContext is the context-only view (#794); resolves token + gitIdentity; wires context into takeoverHandler and workflowInit
│   ├── localRepoIdentity.ts  # Host-neutral origin-remote reader (readLocalRepoIdentity) replacing the GitHub-only readLocalRepoInfo (#844)
│   ├── logger.ts       # Structured logging utilities; `setLogFile` also appends every line, uncoloured, to a file (used by adwMerge's run log)
│   ├── markdownSections.ts  # Pure: the ## sections of an .adw/ file (parseMarkdownSections, sectionValue, stripHtmlComments)
│   ├── modelRouting.ts # Model/effort routing utilities
│   ├── orchestratorCli.ts  # Shared CLI parsing utilities
│   ├── orchestratorLib.ts
│   ├── orchestratorNames.ts  # Static orchestrator name/script mappings (extracted from orchestratorLib to avoid circular imports)
│   ├── agentTimeouts.ts  # Per-phase agent timeout constants
│   ├── pauseQueue.ts   # Pause queue for rate-limit pause/resume; entries carry the reported reset time (ISO 8601) and limit type when known
│   ├── phaseRunner.ts  # PhaseRunner / CostTracker composition; runPhase/runPhasesParallel loop over attempts, riding a five_hour RateLimitError out in-process (rateLimitWaitPolicy.ts) before falling back to the pause path for everything else
│   ├── portAllocator.ts
│   ├── postMergeVerdict.ts  # Pure: the verdict of a scenario re-run on a branch merged with the base branch (green, or red with one failure per failed scenario, failed tag or dev server that did not start), and what a merge-in leaves for the park comment (MergedInBase, PostMergeRed, combineMergedIn)
│   ├── processKill.ts  # Process kill utilities (SIGTERM → SIGKILL escalation)
│   ├── processLiveness.ts  # PID-reuse-safe process liveness checks
│   ├── projectConfig.ts  # Loads and parses the `.adw/` files; `applicationType` has no default (an absent or empty `## Application Type` is `null`); `deviceSources` holds the four device-source sections of `project.md`, each `null` when absent or empty
│   ├── providerConfig.ts  # .adw/providers.md reader (loadProviderConfig/parseCodeHostForge/parseIssueTrackerForge) — moved out of adws/providers/repoContext.ts to keep it under the line cap (#819); yields per-port forge names, not Platform, since #823
│   ├── prReviewInvocation.ts  # resolvePrReviewInvocation — the branch→PR/adwId resolution lifted out of adwPrReview.tsx's main() so it runs after the launch boundary exists (#820)
│   ├── rateLimitWaitPolicy.ts  # Pure decideRateLimitWait/sleepUntil: whether a RateLimitError rides out in-process (five_hour type with a reset time) or escalates to the pause queue
│   ├── regressionTriage.ts  # Pure triage of failing @regression scenarios against single-scenario re-runs on the base branch: the first that fails there too is pre-existing (triageRegressionFailures, scenarioMatchesCase, withRerunTag)
│   ├── remoteReconcile.ts  # Stage derivation from remote GitHub artifacts
│   ├── repoIdentityCrossCheck.ts  # Launch-vs-persisted repo identity cross-check; throws RepoIdentityMismatchError on owner/repo divergence
│   ├── resolveFreezeGuard.ts  # Pure guard: rejects resolve edits that touch .feature files
│   ├── resolveResumeSpawn.ts  # Pure function mapping adwId top-level state to correct orchestrator script + normalized (issueNumber, adwId) args; consumed by cron takeover + scanAuthQueue; defaults to SDLC for legacy adwIds
│   ├── resolvePrReviewTarget.ts  # Pure resolver deciding whether adwPrReview reuses an issue's existing adwId, mints a fresh one, or skips (issue-linked-only)
│   ├── resolveVerdict.ts      # Pure verdict: computes pass/retry/hard-fail for scenario fix loops
│   ├── resumePolicy.ts  # Bounded N-cap resume policy: nextResumeAction computes RESUME/ESCALATE; human_gated stage + escalate_human_gated decision on cap exhaustion
│   ├── retryOrchestrator.ts
│   ├── scenarioDirectories.ts  # Pure resolveScenarioDirectories: the per-issue, regression and step-definition directories `.adw/scenarios.md` names, normalised to repository-relative paths (defaults `features/per-issue`, `features/regression`)
│   ├── scenarioRunner.ts  # Pure `resolveScenarioRunner(runnerMode, projectConfig)`: the run-by-tag command, step-definition directory and extensions, per-tag proof directory, install command and stack signals of each runner mode (`descriptor`: `.adw/` as written; `adw_playwright`: ADW's Playwright project)
│   ├── selfHostLaunch.ts  # Memoised framework-identity check: a launch whose repo is the framework's own (even with `--target-repo` passed) counts as self-host for the guardrails gate
│   ├── slackNotifier.ts  # Slack Incoming Webhook client for error/problem alerting
│   ├── sshCloneUrl.ts  # Host-neutral HTTPS→SSH clone URL rewrite (convertToSshUrl) replacing the GitHub-only version; passes through anything not a two-segment HTTPS URL (#844)
│   ├── stackCoherenceCheck.ts  # Pure stack-coherence check — language coherence + Gherkin mandate (stackCoherenceCheck, StackCoherenceInput/Result/Warning)
│   ├── stageClassifier.ts  # Exhaustive StageClass taxonomy (classifyStage / classifyStageString) — six-class recovery routing (active/awaiting_merge/retriable/resumable/terminal/human_gated) across cron, takeover, and webhook consumers
│   ├── stateHelpers.ts
│   ├── staticCheckFixLoop.ts  # Static-check fix loop with no cap: check runner, fix round through an injected FixRoundPort, guard, check runner; stops when a round makes no progress, i.e. identical combined output or a round the guard rejects (runStaticCheckFixLoop)
│   ├── stepDefDetection.ts  # Step definition file-extension detection by BDD framework (stepDefExtensionsFor, hasStepDefinitions, isGherkinFramework)
│   ├── targetRepoManager.ts  # Target repo workspace shim — SSH clone-URL rewrite + ensureRepoWorkspace delegation + ~/.claude.json trust write via ensureWorkspaceTrusted (#846)
│   ├── testReportParser.ts  # JUnit XML test report parser — reads xunit output into TestReport (total, passed, failed, skipped, per-case status)
│   ├── testVerdict.ts  # Pure test verdict computation (enabled, hasFailures, testcaseCount, frameworkDetected → verdict)
│   ├── unaddressedComments.ts  # readUnaddressedComments — the pr-review bot/self/ADW-signed comment filter over injected reads, decomposed off the legacy prCommentDetector composite (#820)
│   ├── unifiedDiff.ts  # Pure unified-diff parser (parseUnifiedDiff, touchedPaths) feeding the fix-round guard
│   ├── unusedStepIssueBody.ts  # Pure: the `adw:chore` issue the per-issue sweep files listing unused step definitions (capped at 100), and the `Reconciles: unused-step-definitions` marker that keeps it to one open issue per repository
│   ├── unusedStepReport.ts  # Pure unused step report: one usage-report reader per `## BDD Framework` (cucumber-js only; others are not_supported), the dry-run command that writes it, and the step definitions/files no feature file uses
│   ├── upgradeClaim.ts # Atomic upgrade-claim primitive via GitHub branch namespace (winner/loser resolution)
│   ├── upgradeFailureCap.ts  # Pure helpers for counting bot-authored upgrade-failure comments — used by adwUpgrade to cap regeneration failures before escalating to human
│   ├── utils.ts
│   ├── workflowCommentParsing.ts  # Comment parsing utilities
│   ├── workflowMapping.ts  # Issue type → orchestrator mapping
│   ├── workspaceBinding.ts  # bindWorkspaceContext/validateGitRemote (#823) — binds the boundary's already-minted providers to a validated workspace directory; the origin remote is read through the caller's own GitContext, never a second one constructed for the check; moved out of adws/providers/repoContext.ts and adws/core/launchGitContext.ts
│   └── workspaceTrust.ts  # Claude Code workspace-trust write (ensureWorkspaceTrusted) — sets projects[<workspacePath>].hasTrustDialogAccepted in ~/.claude.json atomically (tmp + rename), skips (warn, never throws) on missing/corrupt/unwritable file; called once per repo from ensureTargetRepoWorkspace (#846)
├── forge/              # ADW-application helpers over the forge provider ports (#821)
│   ├── __tests__/      # Vitest unit tests
│   │   ├── adwLabelProvisioning.test.ts
│   │   ├── hitlBoardNotifier.test.ts
│   │   ├── issueLinkMarker.test.ts
│   │   ├── linkedPrDetector.test.ts
│   │   ├── parkComment.content.test.ts
│   │   ├── parkComment.helpers.ts  # Shared helpers for the park-comment tests
│   │   ├── parkComment.postMergeRed.test.ts
│   │   ├── parkComment.quoting.test.ts
│   │   ├── parkComment.structure.test.ts
│   │   ├── prCommentDetector.test.ts
│   │   ├── workflowCommentsBase.test.ts
│   │   └── workflowCommentsIssue.test.ts
│   ├── adwLabelProvisioning.ts  # Idempotently ensures the eight adw:* labels exist on a repo (ensureAdwLabelsExist) — the one piece of label-provisioning policy kept from the deleted labelManager.ts
│   ├── hitlBoardNotifier.ts  # HITL board-event notifier — PR/issue lookup, message building, and Slack delivery for Review and Blocked transitions; readers injected via required NotifierDeps, built by buildNotifierDeps(ctx, repoId) (consumed by adws/core/forgeWiring.ts's adwGitHubForgeDeps, #823; formerly adws/providers/repoContext.ts)
│   ├── issueLinkMarker.ts  # Canonical issue-link marker contract for PR bodies (bodyLinksIssue, closing-keyword conventions)
│   ├── linkedPrDetector.ts  # Detects linked merged or closed PRs for an issue via "Closes"/"Implements #N" body scan; fetchLinkedPRs(codeHost) now reads via the CodeHost.listPullRequests() port method instead of a repoInfo-based free function
│   ├── mergeBlockedComment.ts  # Pure builders for the `merge_blocked` issue comment (buildMergeBlockedComment) and its cause text (buildMergeFailureCause: merge attempts, conflict resolution, local merge check against the base branch)
│   ├── parkComment.ts  # Pure builder for the park comment (ParkReason, ParkEvidence, buildParkComment) posted when a workflow stops for a person
│   ├── parkCommentFormat.ts  # Pure: the inline-code and quoting helpers of the park comments (a fence no text can end early, every quoted line indented so it can stand alone as no directive or heading)
│   ├── postMergeRedComment.ts  # Pure builder for the body of the `post_merge_bdd_red` park comment (describePostMergeRed): the merged-in commits as `git log --oneline` lists them, the files that conflicted, each failing scenario with its error, and the remedy (POST_MERGE_RED_REMEDY)
│   ├── prCommentDetector.ts  # buildUnaddressedCommentReads/hasUnaddressedComments — the pr-review unaddressed-comment read wired to a launch boundary's codeHost/gitContext; shared by prReviewPhase.ts and trigger_cron.ts
│   ├── proofCommentFormatter.ts  # Pure functions transforming structured scenario-proof data into rich markdown for GitHub issue comments — no side effects, no I/O
│   ├── workflowCommentsBase.ts  # isAdwRunningForIssue(issueNumber, tracker) — GitHub-specific workflow comment utilities over an injected IssueTracker
│   ├── workflowCommentsIssue.ts  # Issue workflow comment formatting and posting functions (WorkflowContext, formatWorkflowComment, formatResumingComment, formatHumanGatedComment, formatRateLimitWaitComment)
│   └── workflowCommentsPR.ts  # PR review workflow comment formatting functions (PRReviewWorkflowContext, formatPRReviewWorkflowComment)
├── vcs/                # Version control operations (git)
│   ├── __tests__/      # Vitest unit tests
│   │   ├── branchIdentity.test.ts
│   │   ├── branchOperations.test.ts
│   │   ├── hostileArgv.integration.test.ts
│   │   ├── pushBranch.integration.test.ts
│   │   ├── worktreeProbe.test.ts
│   │   ├── worktreeReset.test.ts
│   │   └── worktreeReuseGate.test.ts
│   ├── branchIdentity.ts  # Pure branch-identity vocabulary — deterministicBranchName, branchMatchesIssue (slug-agnostic)
│   ├── branchOperations.ts  # Branch management
│   ├── commitOperations.ts  # Commit/push operations
│   ├── index.ts
│   ├── worktreeCleanup.ts
│   ├── worktreeCreation.ts
│   ├── worktreeOperations.ts
│   ├── worktreeProbe.ts  # Thin I/O shell gathering Class-A git-operability signals for the reuse gate
│   ├── worktreeQuery.ts  # Worktree query utilities
│   ├── worktreeReset.ts  # Worktree reset to remote for takeover/recovery
│   └── worktreeReuseGate.ts  # Pure REUSE/RESET decision over WorktreeProbe Class-A signals for resume-in-place
├── cost/               # Cost tracking module
│   ├── __tests__/      # Vitest unit tests
│   │   ├── computation.test.ts
│   │   ├── d1Client.test.ts
│   │   ├── extractor.test.ts
│   │   └── phaseCostRecords.test.ts
│   ├── providers/anthropic/  # Anthropic token usage extraction
│   │   ├── extractor.ts
│   │   ├── index.ts
│   │   ├── legacyModelUsage.ts  # Converts token usage maps into the legacy per-model usage shape
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
│   ├── __tests__/      # Vitest unit tests for the pure helpers and the checker/updater
│   │   ├── conformanceCheck.test.ts
│   │   ├── fixtureUpdater.test.ts
│   │   ├── schemaFields.test.ts
│   │   ├── schemaMerge.test.ts
│   │   └── schemaProbe.test.ts
│   ├── fixtures/       # JSONL fixture files for testing
│   │   ├── README.md
│   │   ├── assistant-text.jsonl
│   │   ├── assistant-tool-use.jsonl
│   │   ├── result-error-during-execution.jsonl
│   │   ├── result-error.jsonl
│   │   ├── result-success.jsonl
│   │   ├── session-rate-limited.jsonl       # real capture: a genuine five-hour session limit
│   │   ├── system-api-retry-overloaded.jsonl
│   │   └── system-api-retry-rate-limit.jsonl
│   ├── conformanceCheck.ts  # JSONL conformance validation
│   ├── fixtureUpdater.ts    # Fixture update utility (add-only)
│   ├── index.ts
│   ├── schema.json          # JSONL envelope schema — type/subtype-keyed
│   ├── schemaFields.ts      # Pure: keying, lookup, field extraction, presence checks
│   ├── schemaMerge.ts       # Pure: probe-owned merge and live-drift report
│   ├── schemaProbe.ts       # Schema probe utility (refresh + --check modes)
│   └── types.ts
├── phases/             # Workflow phase implementations
│   ├── __tests__/      # Vitest unit tests
│   │   ├── fixtures/
│   │   │   └── worktreeSetupHarness.ts  # Shared harness for the worktree-setup tests
│   │   ├── applicationTypeGate.declared.test.ts
│   │   ├── applicationTypeGate.helpers.ts
│   │   ├── applicationTypeGate.park.test.ts
│   │   ├── applicationTypeGate.test.ts
│   │   ├── baselinePhase.directives.test.ts
│   │   ├── baselinePhase.helpers.ts  # Shared helpers for the baseline-phase tests
│   │   ├── baselinePhase.test.ts
│   │   ├── baseScenarioRerun.helpers.ts  # Shared helpers for the base-scenario-re-run tests
│   │   ├── baseScenarioRerun.server.test.ts
│   │   ├── baseScenarioRerun.test.ts
│   │   ├── baseWorktree.test.ts
│   │   ├── boundaryTagGate.test.ts
│   │   ├── branchIdentityFallback.test.ts
│   │   ├── branchNameResolution.test.ts
│   │   ├── buildPhase.test.ts
│   │   ├── decidePostReviewOutcome.test.ts
│   │   ├── declaredDevServer.test.ts
│   │   ├── docsSelfCheck.test.ts
│   │   ├── gherkinFreeze.test.ts
│   │   ├── lostPlanGate.test.ts  # planCreatedByEarlierRun truth table; parkIfPlanLost parks a resumed workflow as worktree_lost or returns
│   │   ├── orchestratorLock.claim.test.ts  # claimIssueSpawnLock, and the lifecycle under a lock this process already holds
│   │   ├── orchestratorLock.test.ts
│   │   ├── planPhase.test.ts
│   │   ├── planPhaseCommit.test.ts
│   │   ├── planPhaseResume.test.ts  # executePlanPhase on resume: parks on a lost plan without running the planner
│   │   ├── planValidationPhase.test.ts  # executePlanValidationPhase with a missing plan: parks on resume, throws on a fresh run
│   │   ├── postMergeScenarioRerun.helpers.ts  # Shared harness for the post-merge scenario re-run tests
│   │   ├── postMergeScenarioRerun.phase.test.ts
│   │   ├── postMergeScenarioRerun.test.ts
│   │   ├── preExistingRegressionGate.devices.test.ts
│   │   ├── preExistingRegressionGate.helpers.ts  # Shared helpers for the pre-existing regression gate tests
│   │   ├── preExistingRegressionGate.test.ts
│   │   ├── prPhase.skipPush.test.ts
│   │   ├── prReviewCompletion.test.ts
│   │   ├── prReviewPhase.helpers.ts  # Shared helpers for the PR-review-phase tests
│   │   ├── prReviewPhase.spawnLock.test.ts  # initializePRReviewWorkflow takes the issue's spawn lock before it records itself as the owner
│   │   ├── prReviewPhase.test.ts
│   │   ├── progressGate.test.ts
│   │   ├── reviewPhase.test.ts
│   │   ├── reviewPhaseApprovalGate.test.ts
│   │   ├── reviewPhaseEvidence.test.ts
│   │   ├── reviewPhaseScreenshots.test.ts
│   │   ├── reviewPromptContext.test.ts
│   │   ├── reviewRetryLoop.blocker.test.ts
│   │   ├── reviewRetryLoop.counter.test.ts
│   │   ├── reviewRetryLoop.test.ts
│   │   ├── scenarioProjectSetup.test.ts
│   │   ├── scenarioProofRun.evidence.test.ts
│   │   ├── scenarioProofRun.helpers.ts
│   │   ├── scenarioProofRun.test.ts
│   │   ├── scenarioTestFixLoop.regression.test.ts
│   │   ├── scenarioTestFixLoop.test.ts
│   │   ├── scenarioTestPhase.test.ts
│   │   ├── scenarioTestPhase.boundaryTags.test.ts
│   │   ├── scenarioTestPhase.deviceBoot.test.ts
│   │   ├── scenarioTestPhase.deviceSource.test.ts
│   │   ├── scenarioTestPhase.devices.test.ts
│   │   ├── scenarioTestPhase.helpers.ts
│   │   ├── scenarioTestPhase.runner.test.ts
│   │   ├── scenarioTestPhase.server.test.ts
│   │   ├── startupFailureLog.test.ts
│   │   ├── stackCoherenceReporter.test.ts
│   │   ├── staticCheckFixRound.failure.test.ts
│   │   ├── staticCheckFixRound.fix.test.ts
│   │   ├── staticCheckFixRound.helpers.ts  # Shared helpers for the fix-round tests
│   │   ├── staticCheckFixRound.keepDiscard.test.ts
│   │   ├── staticCheckGate.label.test.ts
│   │   ├── unitTestPhase.guard.test.ts
│   │   ├── unitTestPhase.helpers.ts  # Shared helpers for the unit-test-phase tests
│   │   ├── unitTestPhase.park.test.ts
│   │   ├── unitTestPhase.test.ts
│   │   ├── unitTestPhase.web.test.ts
│   │   ├── upgradeGate.test.ts
│   │   ├── workflowCompletion.test.ts
│   │   ├── workflowInit.test.ts
│   │   ├── workflowPark.recordPark.test.ts
│   │   ├── workflowPark.test.ts
│   │   ├── workflowRepoIdentity.test.ts
│   │   ├── worktreeSetup.test.ts
│   │   ├── worktreeSetupSpecsIgnore.test.ts
│   │   └── worktreeSetupTrackedAssets.test.ts
│   ├── alignmentPhase.ts  # Single-pass alignment phase
│   ├── applicationTypeGate.ts  # Resolves the application type at init; a missing or unknown type parks the workflow (missing_application_type); requireApplicationProfile; readDeclaredApplicationType gives a caller that must never park the profile, or the declared value that did not resolve
│   ├── authPause.ts    # Auth-required pause handler (mirrors rate-limit pause path for auth failures)
│   ├── autoMergePhase.ts  # Auto-approve and merge PR after review passes — the hitl gate's label read, approval read, hold-label write and comment all go through config.repoContext's providers (#796), not adws/github/* free functions
│   ├── baselinePhase.ts  # Baseline phase (executeBaselinePhase): installs, runs the static checks and starts the declared dev server on the base branch before any work; parks the workflow when the base is red, records a green base in the top-level state, does nothing under a waiver
│   ├── baseScenarioRerun.ts  # Single-scenario re-run on the base checkout (buildBaseScenarioRerun): tags the failing scenario, runs it alone under the base branch's dev server where one is declared, reports passed / failed / not run; the devices the gate hands it go into the run command's environment
│   ├── baseWorktree.ts  # Base-branch worktree port: a detached checkout at .worktrees/base-issue-<N>-<adwId>, shared by the baseline and the re-runs and removed when the process exits (buildBaseWorktreePort, sharedBaseWorktree)
│   ├── boundaryTagGate.ts  # Boundary-tag gate run before the scenarios: reads the worktree's `## Real Boundaries` list and per-issue feature files at call time; a missing or undeclared `@boundary-<name>` tag comes back as a failing scenario proof for the fix loop
│   ├── branchIdentityFallback.ts  # Slug-agnostic branch recovery — findExistingBranchForIssue, recoverAdwIdForBranch
│   ├── branchNameResolution.ts  # Branch name resolution for worktree takeover paths
│   ├── declaredDevServer.ts  # The dev server a repository declares in its raw .adw/commands.md (readDeclaredDevServer), shared by the baseline and the scenario phase
│   ├── diffEvaluationPhase.ts  # LLM diff evaluation phase (safe vs regression_possible)
│   ├── docsSelfCheck.ts  # Post-write docs self-check: runs bloat/regrowth guards after documentAgent writes; opens a GitHub issue for each violation. buildDefaultDocsSelfCheckDeps(issueTracker) takes an injected IssueTracker — createIssue/searchOpenIssues, no ad-hoc GitContext construction (#796)
│   ├── gherkinFreeze.ts  # Snapshots, detects changes to, and restores .feature files around the fix loop
│   ├── buildPhase.ts
│   ├── documentPhase.ts
│   ├── index.ts
│   ├── depauditSetup.ts  # depaudit setup and secret propagation (used by adw_init) — propagateSecret takes a CodeHost (defaulting to config.repoContext?.codeHost) and calls setSecret; no repoContext means the secret is recorded skipped with a warning, not a construction attempt (#796)
│   ├── installPhase.ts # Install phase implementation
│   ├── lostPlanGate.ts  # Parks a resumed workflow whose plan went with its removed worktree (worktree_lost); planCreatedByEarlierRun, parkIfPlanLost
│   ├── orchestratorLock.ts  # Orchestrator-lifetime spawn lock (acquire/release wrapper); claimIssueSpawnLock takes it before init writes any state and counts a phase_timeout resume
│   ├── phaseCommentHelpers.ts  # Shared phase comment utilities
│   ├── planPhase.ts
│   ├── planValidationPhase.ts  # Plan-scenario validation phase
│   ├── postMergeScenarioRerun.ts  # rerunScenariosOnMergedBranch — adwMerge's re-run of `@regression` and `@adw-{issue}` on the branch merged with the base branch: reads `.adw/` from the merged worktree, installs, allocates a port and runs the scenario test phase with a narrow config (ScenarioTestPhaseConfig); never throws, any failure of its own is a red verdict
│   ├── preExistingRegressionGate.ts  # Regression gate of the scenario fix loop: re-runs each failing @regression scenario on the base branch and parks the workflow when one fails there too; a waived baseline lets every failure through; for a profile with platforms it re-runs them on an emulator and a simulator created for the re-run and removed after it, and parks `device_boot_failed` when a device does not boot (createPreExistingRegressionGate)
│   ├── progressGate.ts  # Pure build gate: complete on a reported BUILD_COMPLETE, aborts on no_progress (same tree hash) or backstop exhaustion
│   ├── prPhase.ts  # default branch resolved via repoContext.codeHost.getDefaultBranch() when a repo context is available, falling back to config.defaultBranch (#796); gitCtx stays for pushBranch/commandEnv; a run that skips PR creation pushes the pre-PR safety-net commit, so that adwMerge's reset to the remote branch cannot discard it
│   ├── decidePostReviewOutcome.ts  # Pure post-review gate: computes PostReviewOutcome (writeAwaitingMerge, workflowStage) from reviewPassed flag
│   ├── prReviewCompletion.ts  # PR review completion/error handling
│   ├── prReviewPhase.ts  # PR review phase implementation — initializePRReviewWorkflow accepts an optional LaunchBoundary and reuses its providers for createRepoContext when the identities agree, mirroring workflowInit.ts (#796)
│   ├── startupFailureLog.ts  # recordStartupFailure — writes a detached orchestrator's startup failure to its own execution log (never throws)
│   ├── proofPublishPhase.ts  # Publishes scenario proof comment to the PR after scenarioTestPhase
│   ├── reviewPromptContext.ts  # Builds the ReviewPromptContext for a workflow; reviewIssueKind maps issue type + labels (regression-promotion) to a ReviewIssueKind
│   ├── reviewPatchHelpers.ts  # Dispatches review blockers to patchAgent or refactorAgent based on blocker type
│   ├── reviewRetryLoop.ts  # The review retry loop of every review orchestrator (runReviewRetryLoop): the one owner of the review attempt counter, in which a failed dev-server start is a failed review carrying the server's output (serverStartBlocker, recordFailedStartReview)
│   ├── reviewPhase.ts  # Passive judge review phase (reads scenario proof, no dev server) — approval goes through repoContext.codeHost.approvePullRequest, not the adws/github approvePR free function (#796)
│   ├── scenarioFixPhase.ts  # Fixes failed scenarios from a previous scenarioTestPhase run
│   ├── scenarioPhase.ts  # BDD scenario generation phase
│   ├── scenarioTestFixLoop.ts  # Shared scenario test→fix loop with Gherkin freeze, fidelity check, and resolve verdict; hands a dev server that did not start to the review loop
│   ├── scenarioProof.ts  # Scenario proof orchestrator (relocated from agents/)
│   ├── scenarioProjectSetup.ts  # `syncDeclaredScenarioProject`, the upgrade's `syncScenarioProject`: for a regenerated `.adw/project.md` whose type runs on ADW's Playwright project, writes the project's files and installs it (`npm install` and the browser) so the regen commit carries `features/package-lock.json`
│   ├── scenarioTestPhase.ts  # Runs BDD scenarios tagged @adw-{issueNumber} and @regression under the declared dev server; runs none when it does not start; fails before running anything when a profile with platforms lacks a device-source section; for a profile with platforms it runs the scenarios on the workflow's own emulator and simulator, and parks `device_boot_failed` when a device does not boot in three attempts or a host tool is missing
│   ├── sdlcReviewHandoff.ts  # SDLC review-failure handoff extracted from adwSdlc.tsx for BDD testability
│   ├── startupFailureLog.ts  # recordStartupFailure — appends an orchestrator's startup error to its own execution log (never throws; caller rethrows)
│   ├── stackCoherenceReporter.ts  # Warns via the adw:unverified channel on an incoherent detected config (reportStackCoherence)
│   ├── staticCheckFixRound.ts  # Builds the FixRoundPort: one fix-agent run per round over every failing check, committed and diffed (`fix`), pushed (`keep`), or reset to the remote branch and verified to be back at the round's base (`discard`)
│   ├── staticCheckGate.ts  # Static-check gate: runs the checks, drives the fix loop on a red check, parks the workflow when it cannot go green
│   ├── unitTestPhase.ts  # Unit test phase: static-check gate with its fix loop (always), then the unit-test run (unless `unitTests: false`)
│   ├── upgradeGate.ts  # Hash-check upgrade gate: compares framework hash vs .adw-version; parks issue and spawns adwUpgrade on mismatch. buildDefaultUpgradeGateDeps(providers, ...) reads createIssue/applyLabel/updateIssueBody/findOpenUpgradeIssue/moveToStatus off the boundary's providers — no per-call createRepoContext (#796)
│   ├── workflowCompletion.ts  # Workflow completion/error handling; describeRateLimitPauseReason names the limit type and reset time (UTC) on the paused comment when known
│   ├── workflowInit.ts  # Workflow initialization (includes upgradeGate check). The launch boundary is the only source of forge providers: defaultBranch comes from boundary.providers.codeHost, and exported resolveWorkflowProviders(boundary, callerRepoId?) decides identity/provider reuse — a caller-supplied repoId that contradicts the boundary is refused (throws) rather than served a second, ad-hoc-minted provider set (#796)
│   ├── workflowPark.ts  # parkWorkflow — a deliberate human-gated stop with a park comment; records the stage the park reason maps to (human_gated, or worktree_lost for a lost plan); `## Retry` re-arms it; recordPark is the park without the exit, for a run that ends in its own way (adwMerge), writing the state before the comment
│   ├── workflowRepoIdentity.ts  # resolveWorkflowRepoId(config) — repoContext.repoId → gitContext → targetRepo precedence, replacing every phase's own `?? getRepoInfo()` wrong-repo fallback (#820)
│   └── worktreeSetup.ts  # Gitignore and worktree setup helpers, including the runtime `specs/` ignore
├── types/              # Type definitions
│   ├── agentTypes.ts
│   ├── dataTypes.ts
│   ├── index.ts
│   ├── issueRouting.ts  # Issue routing type definitions
│   ├── issueTypes.ts
│   └── workflowTypes.ts
├── triggers/           # Automation triggers
│   ├── __tests__/      # Vitest unit tests
│   │   ├── fixtures/
│   │   │   ├── autoMergeHandlerHarness.ts  # Shared recording git exec and GitContext fakes for the auto-merge handler tests; makeScriptedRepository answers the git reads and writes of the merge loop from a model of the repository, so that HEAD moves when the base branch is merged in
│   │   │   ├── devServerJanitorDeps.ts  # Shared dependency fakes for the dev-server janitor tests
│   │   │   ├── deviceJanitorDeps.ts  # Shared dependency fakes for the device janitor tests
│   │   │   ├── docsIndexSweepHarness.ts  # Shared fakes for the docs-index sweep tests
│   │   │   ├── perIssueScenarioSweep.base.ts  # Frozen copy of the pre-refactor per-issue sweep, the reference for the equivalence tests
│   │   │   ├── perIssueSweepDeps.ts  # Shared sweep dependency fakes: tracked-file listing, in-memory issue tracker, step-usage outcomes
│   │   │   ├── perIssueSweepPersistHarness.ts  # Shared GitContext/CodeHost/SweepBase fakes for the sweep-persist tests
│   │   │   └── retryHandlerDeps.ts  # Shared dependency fakes for the retry handler tests
│   │   ├── autoMergeHandler.postMerge.test.ts
│   │   ├── autoMergeHandler.test.ts
│   │   ├── baseIntegration.test.ts
│   │   ├── cancelHandler.test.ts
│   │   ├── concurrencyGuard.test.ts
│   │   ├── continueHandler.test.ts
│   │   ├── cronIssueFilter.eligibility.test.ts
│   │   ├── cronIssueFilter.optOut.test.ts
│   │   ├── cronIssueFilter.test.ts
│   │   ├── cronIssueFilterFixtures.ts  # Shared fixtures for the cronIssueFilter tests
│   │   ├── strandedStartingRecovery.test.ts
│   │   ├── cronIssueListing.test.ts
│   │   ├── cronLabelEligibility.test.ts
│   │   ├── cronLaunchLedger.test.ts
│   │   ├── cronRepoResolver.test.ts
│   │   ├── cronStageResolver.test.ts
│   │   ├── devServerJanitor.issueLock.test.ts
│   │   ├── devServerJanitor.test.ts
│   │   ├── deviceJanitor.decisions.test.ts
│   │   ├── deviceJanitor.failures.test.ts
│   │   ├── deviceJanitor.spawnLock.test.ts
│   │   ├── deviceJanitor.test.ts
│   │   ├── docsIndexSweep.test.ts
│   │   ├── docsIndexSweepDecisions.test.ts
│   │   ├── docsIndexSweepDefaults.test.ts
│   │   ├── docsIndexSweepReportBranch.test.ts
│   │   ├── issueClosedUnblockRouter.test.ts
│   │   ├── issueOpenedRouter.test.ts
│   │   ├── mergeDispatchGate.test.ts
│   │   ├── pauseQueueDecider.test.ts
│   │   ├── pauseQueueScanner.test.ts
│   │   ├── perIssueScenarioSweep.test.ts
│   │   ├── perIssueScenarioSweep.directories.test.ts
│   │   ├── perIssueScenarioSweep.equivalence.test.ts
│   │   ├── perIssueScenarioSweep.unusedSteps.test.ts
│   │   ├── perIssueSweepPersist.test.ts
│   │   ├── perIssueSweepPersistBase.test.ts
│   │   ├── perIssueSweepStepUsage.test.ts
│   │   ├── sweepImportGraph.test.ts
│   │   ├── sweepRemovalGate.test.ts
│   │   ├── rateLimitProbe.test.ts
│   │   ├── regionOverlap.test.ts
│   │   ├── regionOverlapSignals.test.ts
│   │   ├── retryHandler.parkReason.test.ts
│   │   ├── retryHandler.test.ts
│   │   ├── scanAuthQueue.test.ts
│   │   ├── spawnGate.test.ts
│   │   ├── takeoverHandler.test.ts  # Unit tests for all takeoverHandler decision-tree branches
│   │   ├── takeoverHandler.integration.test.ts  # Integration test for the abandoned takeover path
│   │   ├── trigger_cron.test.ts
│   │   ├── trigger_webhook.test.ts
│   │   ├── triggerCronAwaitingMerge.test.ts
│   │   ├── upgradeRedrive.test.ts
│   │   ├── webhookEventBoundary.test.ts
│   │   ├── webhookGatekeeper.test.ts
│   │   ├── webhookHandlers.test.ts
│   │   └── webhookRepoResolver.test.ts
│   ├── autoMergeHandler.ts  # Auto-merge approved PRs: the local merge check, the base brought in and proven by a scenario re-run before the forge is asked to merge (a red re-run ends the loop with postMergeRed), and stale-mergeability retries
│   ├── baseIntegration.ts  # bringBaseIn merges origin/<base> into the branch (a plain merge, or /resolve_conflict) and reports whether the branch already held the tip, the commits merged in and the files that conflicted; baseMovedPast and commitsMissingFrom read whether the base holds commits the branch lacks
│   ├── cancelHandler.ts  # Cancel directive handler
│   ├── retryHandler.ts   # Retry directive handler: resets merge_blocked → awaiting_merge (no worktree teardown); re-arms human_gated (every park reason, post_merge_bdd_red included), review_failed and worktree_lost to phase_timeout; respawns `paused` workflows
│   ├── cloudflareTunnel.tsx  # Cloudflare tunnel lifecycle helper
│   ├── concurrencyGuard.ts
│   ├── continueHandler.ts  # Continue directive handler: records a waiver and re-arms a human_gated workflow parked for baseline_red, base_server_down or pre_existing_regression (handleContinueDirective, decideContinueAction); called by trigger_cron.ts and trigger_webhook.ts
│   ├── cronIssueFilter.ts  # Cron issue evaluation and filtering logic (testable, extracted from trigger_cron)
│   ├── cronIssueListing.ts  # Cron's open-issue listing, extracted from trigger_cron (module-private functions there aren't step-def-drivable)
│   ├── cronLabelEligibility.ts  # Pure label-recovery decision for cron backlog sweeper — spawns adw:*-labelled issues with no state
│   ├── cronLaunchLedger.ts  # The takeover launches this cron process made, by issue, so the next poll does not launch a second orchestrator while the first is still starting up and has not yet taken the spawn lock
│   ├── devServerJanitor.ts  # Janitor probe that kills stale dev server processes in ADW-managed (.adw-marked) target repo worktrees; leaves a worktree alone while a live process (such as adwMerge) holds its issue's spawn lock
│   ├── deviceJanitor.ts  # Janitor probe that removes emulators and simulators left behind by dead workflows (orchestrator not running and no live holder of the issue's spawn lock, worktree outside the dev-server janitor grace period)
│   ├── docsIndexSweep.ts  # Cron probe for docs-index health sweep
│   ├── docsIndexSweepDefaults.ts  # Production dependency defaults for docsIndexSweep
│   ├── perIssueScenarioSweep.ts  # Cron probe: deletes per-issue feature-{N}.feature (+ feature-{N}.* / feature-{N}-* step defs, + step defs whose feature is gone) 14 days after the issue's PR merges, from the directories `.adw/scenarios.md` names, keeping step-def files a remaining scenario still uses; every batch through sweepRemovalGate; acts on the injected launch boundary's repo (git ops on its GitContext, merged-PR lookups via its CodeHost), no identity resolution of its own (#797)
│   ├── perIssueSweepPersist.ts  # Persists a sweep removal batch via a dedicated worktree/branch/immediately-merged PR, resolved from the passed launch boundary — worktree ops on its GitContext, PR ops on its CodeHost (#797)
│   ├── perIssueSweepStepUsage.ts  # The sweep's dry run that writes the scenario runner's usage report, the step files it keeps out of a removal batch, and the reconcile that files at most one unused-step `adw:chore` issue per repository; never throws
│   ├── sweepImportGraph.ts  # Pure relative-import graph: keeps removal candidates a surviving file still imports; maps tsc TS2307 output back to removed files
│   ├── sweepRemovalGate.ts  # Post-removal gate in the sweep worktree: base checks, apply removals, re-run static checks, restore files reported missing, hard-fail (discard batch) otherwise
│   ├── cronProcessGuard.ts  # Duplicate cron process prevention
│   ├── cronRepoResolver.ts  # Cron repo identity resolution (testable, extracted from trigger_cron)
│   ├── cronStageResolver.ts  # Cron stage resolution from top-level state file (testable)
│   ├── issueClosedUnblockRouter.ts  # Pure selection + DI orchestration for issues.closed dependency-unblock; uses extractDependencies (prose-aware) instead of heading-only parseDependencies
│   ├── issueDependencies.ts
│   ├── issueEligibility.ts
│   ├── issueOpenedRouter.ts  # Pure routing decision for the issues.opened label-routing path (mirrors cronIssueFilter pattern)
│   ├── mergeDispatchGate.ts  # Lock-aware gate deciding whether cron should dispatch adwMerge for an issue
│   ├── pauseQueueDecider.ts  # Pure pause-queue decider: ownership gate (skip_not_owner), reset-time gate, resume, refresh_reset, count_strike, evict
│   ├── pauseQueueResume.ts  # Extracted from pauseQueueScanner: resumeWorkflow removes the queue entry before spawning the orchestrator (closes the duplicate-spawn window), re-appending it with a strike via appendToPauseQueue if the spawn fails inside its readiness window; injectable spawn seam
│   ├── pauseQueueScanner.ts  # Thin shell over pauseQueueDecider: scans as one cron — probes only entries the scanning cron's launch identity owns, at most once per scan, never before an owned entry's reset time; posts best-effort stage/error comments through a per-entry launch boundary (buildLaunchBoundary from the entry's own --target-repo args), fixing a latent bug where target-repo entries' error comments were silently dropped by a cwd-vs-remote identity mismatch (#797)
│   ├── rateLimitProbe.ts  # Pause-queue probe: stream-json ping classified through claudeStreamParser (clear/limited/failed/unknown) returning the limit type and reset time; no text fallback; injectable exec
│   ├── regionOverlap.ts  # Pure decision module for region-overlap serialization (no I/O)
│   ├── regionOverlapSignals.ts  # Side-effecting boundary for region-overlap: registers durable Blocked-by deps and posts explanatory comments
│   ├── scanAuthQueue.ts  # Cron probe: resumes paused_auth orchestrators after auth is restored
│   ├── spawnGate.ts  # Per-issue filesystem lock preventing duplicate orchestrator launches; isIssueLockHeldByLiveProcess tells the janitors that a live process other than themselves holds an issue's lock
│   ├── takeoverHandler.ts  # Candidate decision tree: evaluateCandidate composes spawnGate, processLiveness, agentState, remoteReconcile, and worktreeReset
│   ├── trigger_cron.ts
│   ├── trigger_shutdown.ts  # Graceful shutdown handler
│   ├── trigger_webhook.ts
│   ├── upgradeRedrive.ts  # Cron redrive scan: re-spawns adwUpgrade for stranded #UPG tracking issues (bounded by MAX_FAILURES)
│   ├── webhookEventBoundary.ts  # Per-event resilience boundary: context/formatting helpers plus a no-throw reportWebhookEventFailure() (log + best-effort Slack alert)
│   ├── webhookGatekeeper.ts
│   ├── webhookHandlers.ts
│   ├── webhookRepoResolver.ts  # Per-event boundary resolver — builds one GitContext per webhook event from payload repo identity
│   └── webhookSignature.ts
├── r2/                 # Cloudflare R2 upload module
│   ├── bucketManager.ts  # R2 bucket creation and lifecycle rules
│   ├── r2Client.ts     # R2 client factory
│   ├── types.ts        # R2 type definitions
│   ├── uploadService.ts  # File upload logic
│   └── index.ts
├── promotion/          # Vocabulary registry and scenario parsers, nomination collector
│   ├── __tests__/      # Vitest unit tests
│   │   ├── nominationCollector.test.ts
│   │   ├── perIssueScenarioFiles.test.ts
│   │   ├── scenarioParser.test.ts
│   │   └── vocabularyParser.test.ts
│   ├── index.ts        # Barrel re-exporting the parsers, the nomination collector and the per-issue file reader
│   ├── nominationCollector.ts  # Pure collector of `@nominated` / `@nomination-declined` Per-Issue Scenarios of merged issues, with their NominationState (collectNominations)
│   ├── perIssueScenarioFiles.ts  # Reads the Per-Issue Scenario files of a default-branch checkout (readPerIssueScenarioFiles)
│   ├── scenarioParser.ts      # Parses Gherkin .feature files into Scenario objects, including scenarios nested in Rule blocks
│   ├── vocabularyParser.ts    # Parses features/regression/vocabulary.md into VocabularyRegistry
│   └── types.ts        # Shared types (VocabularyEntry, Scenario, Step, etc.)
├── proof/              # PR proof publishing module
│   ├── __tests__/      # Vitest unit tests
│   │   ├── featureFileReader.test.ts
│   │   ├── featureScenarioIndex.examples.test.ts
│   │   ├── featureScenarioIndex.lookup.test.ts
│   │   ├── featureScenarioIndex.test.ts
│   │   ├── imagePlatform.test.ts
│   │   ├── prProofPublisher.noReport.test.ts
│   │   ├── prProofPublisher.publish.test.ts
│   │   ├── prProofPublisher.test.ts
│   │   ├── proofArtifactHarvester.test.ts
│   │   ├── proofAssembler.helpers.ts
│   │   ├── proofAssembler.images.test.ts
│   │   ├── proofAssembler.platforms.test.ts
│   │   ├── proofAssembler.scenarios.test.ts
│   │   ├── proofAssembler.test.ts
│   │   ├── proofAssembler.undefinedSteps.test.ts
│   │   └── proofUploader.test.ts
│   ├── featureFileReader.ts    # Reads a per-issue `.feature` file for the proof assembler
│   ├── featureScenarioIndex.ts # Indexes a feature file's scenarios so proof images can be matched to them
│   ├── imagePlatform.ts        # Reads a per-issue image's platform from its first directory (android/, ios/) and each scenario's platform coverage
│   ├── index.ts
│   ├── prProofPublisher.ts     # Formats JUnit summary + screenshots and posts proof comment to PR
│   ├── proofArtifactHarvester.ts  # Pure recursive harvester of image artifacts from proof directory
│   ├── proofAssembler.ts       # Assembles the per-issue proof images into one proof document
│   ├── proofDocument.ts        # Proof document model/rendering used by the proof assembler
│   ├── proofUploader.ts        # Harvests the proof directory and uploads its images to R2; shared by the review phase and the PR proof comment
│   └── types.ts
├── known_issues.md     # Known issues and workarounds
├── guard/              # Git/GH CLI Guard rule modules (#795) — the extraction-readiness rule (extractionRule.ts) and its tests were retired along with adws/gitContext/adws/providers (#840)
│   ├── violationTypes.ts    # Shared ViolationRule ('git-gh-shellout' | 'cwd-derived-identity' | 'unsanctioned-construction') / Violation types
│   ├── identityRule.ts      # cwd-derived-identity rule (#769) — gitContextForRepo(getRepoInfo())/forgeProviders({ identity: getRepoInfo() }) composites (CONTEXT_CONSTRUCTOR_NAMES, since #823) — the flagged names are now imported from `@paysdoc/devplatform` (#840)
│   ├── guardReport.ts       # Formats collected violations into a guard report
│   └── constructionRule.ts  # unsanctioned-construction rule (#795) — ad-hoc provider/context construction outside a one-entry, PERMANENT-only launch-boundary allowlist (adws/core/launchGitContext.ts only; the library's own forgeProviders.ts is no longer a second in-repo site to sanction since #840)
├── checkBranchNames.ts  # Branch-name guard: fails when non-test TypeScript or markdown under `adws/`, or a slash command under `.claude/commands/`, names a branch to act on; the base branch is resolved at run time (`bun run lint:branch-names`)
├── checkCommentOnly.ts  # Comment-discipline guard: proves a batch of files differs from a base ref only in comments/JSDoc/whitespace via TypeScript-parser and Gherkin-DocString-aware token comparison (`bun run lint:comment-only`), backing comment de-bloat sweep batches
├── checkGitGhGuard.ts  # CI guard entry point: discovery + git-gh-shellout rule + composes the three rules; fails build if any bypass the chokepoint (`bun run lint:git-guard`)
├── checkLivingDocsIndex.ts  # Migration acceptance gate: validates conditional_docs.md ↔ app_docs/ bijection
├── checkModelLiterals.ts  # Model-literal guard: fails when a call site under `adws/` or `scripts/` outside `core/modelRouting.ts` names a model literally (`bun run lint:model-literals`)
├── adwBuild.tsx        # Orchestrators (individual & combined)
├── adwChore.tsx        # Chore pipeline with LLM diff gate (auto-merge)
├── adwMerge.tsx        # Merge orchestrator (awaiting_merge handoff). Exported buildDefaultDeps(boundary) sources findPRByBranch/issueHasLabel/fetchPRApprovalState/commentOnIssue from the launch boundary's providers — no repoInfo parameter, no ad-hoc GitHub construction (#796). Each run appends its log lines to `logs/{adwId}/merge.log` (`startMergeLog`). Before it asks the forge to merge, the loop brings the base branch in and re-runs the scenarios on the result (`rerunScenarios`); a red re-run parks the workflow as `human_gated` / `post_merge_bdd_red` instead of merging
├── adwUpgrade.tsx         # Framework upgrade orchestrator — regenerates .adw/ when hash drifts; opened as winner of upgradeClaim; exempt from initializeWorkflow(). main() builds one buildLaunchBoundary() and exported buildDefaultUpgradeDeps(providers, gitCtx) sources every forge dep (labels, comments, PR create/merge, board move) from it — the ad-hoc createGitHubCodeHost(repoId) construction and the six direct GitContext forge-semantic calls are gone (#796)
├── adwBuildHelpers.ts
├── adwClearComments.tsx
├── adwDocument.tsx
├── adwPatch.tsx
├── adwPlan.tsx
├── adwPlanBuild.tsx
├── adwPlanBuildDocument.tsx
├── adwPlanBuildReview.tsx
├── adwPlanBuildTest.tsx
├── adwPlanBuildTestReview.tsx
├── adwPrReview.tsx     # PR review orchestrator — builds a launch boundary and hands it to initializePRReviewWorkflow() rather than deriving the repo identity a second time via buildRepoIdentifier() (#796)
├── adwSdlc.tsx
├── adwTest.tsx
├── healthCheck.tsx     # Health check orchestrator
├── healthCheckChecks.ts
├── workflowPhases.ts   # Workflow phase re-exports
├── index.ts
├── tsconfig.json
└── README.md
.adw-version                # Framework content hash — read by upgradeGate on every workflow start
.github/
├── adw.yml             # ADW self-configuration for this repo (hitl, unit-test gate)
├── dependabot.yml       # Weekly @paysdoc/devplatform bump PRs against dev, merged by hand (outside the ADW pipeline)
└── workflows/
    ├── deploy-workers.yml        # Auto-deploy Cloudflare Workers on push to main
    ├── envelope-conformance.yml  # Stream-json envelope gate: jsonl:check on every PR, pinned Claude CLI
    ├── git-cli-guard.yml         # CI guard: rejects direct git/gh shell-outs that bypass GitContext
    └── regression.yml            # Periodic @regression BDD scenario runner
workers/                # Cloudflare Workers
├── cost-api/           # Cost data ingestion API (costs.paysdoc.nl, D1-backed)
│   ├── src/
│   │   ├── auth.ts         # Bearer token authentication
│   │   ├── cors.ts         # CORS middleware
│   │   ├── index.ts        # Worker entry point
│   │   ├── ingest.ts       # POST /api/cost handler
│   │   ├── migrations/     # D1 SQL migrations
│   │   │   └── 0001_initial.sql  # Initial D1 schema migration
│   │   ├── queries.ts      # D1 query helpers
│   │   ├── schema.sql      # D1 database schema
│   │   └── types.ts        # Worker type definitions
│   ├── test/
│   │   ├── cors.test.ts    # CORS middleware tests
│   │   ├── ingest.test.ts  # Ingest endpoint tests
│   │   └── queries.test.ts # D1 query tests
│   ├── .gitignore
│   ├── bun.lock            # Bun lockfile
│   ├── package-lock.json   # npm lockfile (Workers deploy tooling)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── wrangler.toml       # Cloudflare Workers config
└── screenshot-router/  # Screenshot URL routing worker
    ├── src/
    │   └── index.ts    # Worker entry point
    ├── bun.lock         # Bun lockfile
    ├── package.json
    ├── tsconfig.json
    └── wrangler.toml   # Cloudflare Workers config
test/                   # Integration test infrastructure
├── fixtures/           # Static test fixtures
│   ├── cli-tool/       # Fixture target repo for BDD scenario testing (Node.js/TypeScript)
│   │   ├── .adw/       # ADW config for fixture repo
│   │   ├── src/        # Minimal CLI tool source (cli.ts)
│   │   ├── README.md
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── python-flat/    # Fixture target repo for Python stack testing (pytest, flat layout)
│   │   ├── .adw/       # ADW config for fixture repo
│   │   ├── tests/      # Minimal pytest suite
│   │   ├── README.md
│   │   ├── calculator.py
│   │   └── pyproject.toml
│   ├── github/         # GitHub API response fixtures (default-issue.json, default-pr.json, default-comments.json)
│   ├── jsonl/          # JSONL fixture files for testing
│   │   ├── envelopes/  # Stub envelope templates — checked by `bun run jsonl:check`
│   │   │   ├── assistant-message.jsonl
│   │   │   ├── assistant-rate-limited.jsonl
│   │   │   ├── rate-limit-event-rejected.jsonl
│   │   │   ├── result-message.jsonl
│   │   │   ├── result-rate-limited.jsonl
│   │   │   └── system-message.jsonl
│   │   ├── manifests/  # Named scenario manifests for stub sequencing (adw-sdlc, adw-init, adw-upgrade, review, pr-review, scenario-writer, surface-* phases, rate-limit-pause-resume, diff-verdict, adw-sdlc-post-merge-retry)
│   │   └── payloads/   # Canned agent payloads (plan, build, review, issue classification)
│   └── python-app/     # Fixture target repo for Python app (behave/pytest-bdd BDD scenario testing: app.py, features/, tests/)
├── mocks/              # Mock implementations
│   ├── __tests__/      # Vitest unit tests for mock infrastructure
│   │   ├── fixtures/
│   │   │   └── manifestHarness.ts  # Shared harness for the manifest interpreter tests
│   │   ├── claude-cli-stub.test.ts
│   │   ├── ghShadowHostileTitle.test.ts
│   │   ├── ghShadowLanding.test.ts
│   │   ├── ghShadowPullRequestHandover.test.ts
│   │   ├── ghShadowState.test.ts
│   │   ├── gitRemoteMock.test.ts
│   │   ├── manifestByCommand.test.ts
│   │   ├── manifestInterpreter.test.ts
│   │   ├── manifestInterpreterGit.test.ts
│   │   ├── manifestRefusalGuard.test.ts
│   │   ├── mockServerDispatch.test.ts
│   │   ├── stubErrorAndFlags.test.ts
│   │   └── test-harness.test.ts
│   ├── claude-cli-stub.ts      # Claude CLI process stub (incl. on-demand rate-limited response; finds its marker manifest in its cwd or the nearest directory above it)
│   ├── gh-cli-shadow.ts        # `gh` CLI shadow run behind a /bin/sh wrapper named `gh`: answers reads from a forge state file, logs each write as the REST request it stands for, refuses every other call
│   ├── ghShadowArgs.ts         # Pure: the shadow's outcome types and flag parser
│   ├── ghShadowCommands.ts     # Pure: routes one `gh` call to its read or write handler, or refuses it
│   ├── ghShadowLanding.ts      # Pure: lands a shadowed PR merge onto the fixture remote so later reads see the merged state
│   ├── ghShadowReads.ts        # Pure: the shadow's reads (token, repo, issue and PR view and list, `api` GETs)
│   ├── ghShadowState.ts        # Pure: the gh-shaped forge state, its normalisation from the mock server's state, and the `--json` projection
│   ├── ghShadowWrites.ts       # Pure: the shadow's writes (comments, labels, issue and PR create, edit, close, merge and review, secrets)
│   ├── git-remote-mock.ts      # Git remote mock
│   ├── gitMockLog.ts           # The git mock's JSON-lines invocation log, appended by git-remote-mock.ts and read back by push-asserting steps
│   ├── gitContextFixture.ts    # Shared GitContext test fixture builder
│   ├── github-api-server.ts    # GitHub API mock HTTP server
│   ├── manifestInterpreter.ts  # JSONL manifest interpreter for stub sequencing (incl. per-command lookup)
│   ├── manifestRefusalGuard.ts # Guard that refuses manifests which would mask a stub failure
│   ├── manifestSchema.ts       # Manifest shape and validation
│   ├── stubArgs.ts             # Claude CLI stub argument parsing
│   ├── stubMarker.ts           # Pure upward lookup of the stub's `.adw-stub-manifest.json` marker from a directory to the filesystem root
│   ├── stubResponse.ts         # Pure helpers: response-mode resolution, rate-limited line building
│   ├── test-harness.ts         # Test harness orchestrating all mocks; `withRealGit` takes the git mock off `PATH` for one in-process run that must reach a fixture's real `origin`
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
├── per-issue/          # Per-issue scenarios — run by their own workflow's test phase only; swept 14 days after PR merges
│   ├── step_definitions/  # Per-issue step definition files
│   └── support/        # Per-issue Cucumber support drivers (e.g. feature-846-ensure-driver.ts)
├── regression/         # Regression scenario vocabulary, typed World, and surface/smoke scenarios
│   ├── cost/           # Regression scenarios covering cost records (the CLI's reported cost, token estimates, the cost API) and the Worker deploy workflow's change detection (#936)
│   ├── drivers/        # Scripts run as child processes, outside the support and step-definition directories, which Cucumber imports: the workflow-init driver the subprocess harness runs, and the cost-section and cost-commit drivers of the cost scenarios
│   ├── envelope/       # Regression scenarios covering the Claude CLI stream-json envelope conformance gate, its fixture updater and schema probe, and the Claude CLI stub's on-demand rate-limited response (#909)
│   ├── hashing/        # Regression scenarios covering framework content hashing (#537)
│   ├── labels/         # Regression scenarios covering ADW labels (#932): adw:none starting no run on any spawn path, conflicting classification labels, the label catalogue a repository's cron provisions at start, and routing a major-upgrade issue by its label
│   ├── merge/          # Regression scenarios covering adwMerge's merge loop: a refusal GitHub gives while the local merge check finds the branch clean is treated as stale and the merge asked again after 3, 6, 12 and 24 seconds without "/resolve_conflict"; a branch in conflict, even one that a commit landing on the base branch after the push puts in conflict, goes through "/resolve_conflict" and its merge commit is pushed before GitHub is asked again; the "ADW Merge Blocked" comment says how many merge attempts there were, whether conflict resolution ran, what the local merge check found and the last error; and adwMerge saves its output in logs/<adwId>/merge.log; and regression scenarios covering adwMerge re-running `@regression` and the issue's scenarios on the branch merged with the base before it merges: merging once both pass, no re-run for a branch already on the base's tip or for a repository without scenarios, a second re-run after a conflict lands mid-merge, the `human_gated` park for `post_merge_bdd_red` and its "ADW Parked" comment, and `## Retry` resuming it under the same adwId (#1101)
│   ├── mobile/         # Regression scenarios covering "mobile:kotlincm" repositories: the framework upgrade keeping a hand-set application type and device sources, a bootstrap issue's baseline passing with no Gradle build yet, the "## Run Tests" command gathering each module's JUnit reports, and the scenario phase running each tag through the ":scenarios" Gradle module and giving the proof each platform's screenshots (#1044)
│   ├── multilang/      # Regression scenario covering the Python fixture repo end-to-end
│   ├── pause-queue/    # Regression scenarios covering the rate-limit probe's verdict, its parity with the agents' rate-limit detector and a limited probe never counting toward eviction (#902), the pause queue's reset-time wait, decider, eviction (#910), ownership and remove-before-spawn resume (#911)
│   ├── plan-commit/    # Regression scenarios covering the plan staying in the worktree: the plan phase adds no commit and no commit on the branch touches `specs/` (#930); worktree setup has git ignore `specs/` through the tracked `.gitignore`, once, leaving a `.gitignore` the branch already carries as it is; the plan phase leaves every other change uncommitted, even under `.claude/` and `.adw/`; and a full adwSdlc run posts no "Committing Plan" comment (#1077)
│   ├── planner/        # Regression scenarios covering the planner of an issue in a target repository: it runs the framework checkout's current "/feature", "/bug" or "/chore" planning command from the copy worktree setup puts in the worktree, even when the branch tracks an older copy, and is handed the issue's number, adwId, title and body; and the planning command ADW ships tells the planner of a port that must not change behaviour to add a behavioural equivalence step whose comparison is a validation command, without forcing one on an issue that changes behaviour (#1104)
│   ├── playwright/     # Regression scenarios covering web repositories running their Gherkin on ADW's Playwright project: the framework upgrade installing it in features/ byte-identical to its template (beside the repository's own e2e setup, never for cli), the scenario test phase running npx bddgen then npx playwright test with the dev server's address and ADW's report and proof paths, and a fresh web repository's real run (#992)
│   ├── proof/          # Regression scenarios covering the scenario proof and the BDD Proof comment of a tag whose scenario runner writes no JUnit report to ADW_JUNIT_REPORT_PATH: the tag still passes or fails on its exit code, the comment shows "no report" and says the counts are unavailable instead of "0 passed, 0 failed", the comment and the tag's proof section warn that it passed on the exit code only, a report with no test case still fails as a blocker, and a run with a report is shown as before (#1102)
│   ├── rate-limit/     # Regression scenarios covering rate-limit detection — the limit type and reset time carried from the stream parser through the rate-limit error to the pause-queue probe, which classifies documented signals only (#907) — and the in-process wait for a five-hour rate limit: the wait policy, the announced waits, liveness while waiting, and the pause-path fallback (#912)
│   ├── resume/         # Regression scenario covering a workflow resumed after its worktree was removed: it parks as `worktree_lost` instead of re-running the planner (#1078)
│   ├── retry-directive/  # Regression scenarios covering the ## Retry directive: reviving a workflow stranded in the paused stage, while paused_auth, running, finished and human-gated stages behave as before (#908)
│   ├── review/         # Regression scenarios covering the review comment on the issue: it shows the screenshots of the proof run the review judged, each embedded from the URL its upload returned, on a passing and a failing review, and a screenshot never decides or blocks the review (#937)
│   ├── smoke/          # High-level smoke scenarios (cron spawn, SDLC, cancel, chore, pause)
│   ├── spawn-lock/     # Regression scenarios covering an orchestrator that finds an issue's spawn lock held by another live process: it exits 0 without running a phase, logs the pid that holds the lock, and leaves the top-level state and the workflow's resume attempts as the holder recorded them; and the cron launching no second orchestrator for a timed-out workflow whose relaunched orchestrator is still starting up, relaunching it once that orchestrator has exited without spending a resume attempt on it (#1105)
│   ├── step_definitions/  # Typed Given/When/Then steps and RegressionWorld for regression scenarios
│   ├── support/        # Cucumber hooks and the in-process phase harness (phaseRun, phaseConfig, fixtureWorktree, claudeCliStub, mockForgeProviders, cleanup) that runs a single phase against stubs for the surface rows; launchRecorder.ts, the shared bunx PATH shadow that records each launch's argv; and the hermetic subprocess harness (subprocessHarness, subprocessRun, subprocessDrivers, harnessOrchestrators, forgeShadow, fixtureTargetRepo, webhookTarget, seededRecords) that runs the init, merge, patch, cron and cancel-directive rows as real child processes against stand-ins; standInDevices.ts, the stand-in for the host's device tools (avdmanager, emulator, adb, xcrun simctl) that the real device lifecycle runs over in the scenarios that run the scenario test phase on a repository with platforms, and that answers like a host whose devices do not boot or whose tools are not installed when a scenario says so
│   ├── surfaces/       # Per-phase surface scenarios (row-01 through row-35, gap at row-28, covering every orchestrator phase)
│   ├── takeover/       # Regression scenarios covering the cron taking over a workflow whose orchestrator died in starting or in a running stage under its adwId, a live orchestrator never killed, reset or doubled, a spawn lock the cron itself left behind, and an orchestrator logging the error that stopped its startup (#959)
│   ├── upgrade/        # Regression scenario covering the framework self-upgrade path (#729)
│   ├── webhook/        # Regression scenarios covering the webhook launching a cron for every accepted event that names a repository
│   └── vocabulary.md   # Canonical BDD phrase registry with rot-detection rubric for @regression authoring
├── step_definitions/   # Top-level step definitions (repo-identity persistence scenario)
└── support/            # Top-level Cucumber support (tsx registration; cucumberChildRun.ts, the shared runner for nested cucumber-js child runs)
docs/                   # Durable design records
├── adr/                # Architecture Decision Records, one per design decision (index: docs/adr/README.md)
└── prd/                # Product requirement documents
specs/                  # Per-run implementation plans, ignored at runtime by worktree setup, so each lives only in the worktree that wrote it
scripts/                # Standalone operational scripts
└── guardrails-probe.ts # Startup probe run as a subprocess by guardrailsGate.ts to verify target-repo guardrails injection is safe before use
.env.sample             # Environment variable template
.gitignore
package.json
tsconfig.json           # Root TypeScript configuration
vitest.config.ts        # Vitest test configuration
known_issues.md         # Production incidents, recurring failure patterns, and resolution status
README.md               # This file
UBIQUITOUS_LANGUAGE.md  # DDD ubiquitous language glossary
```
