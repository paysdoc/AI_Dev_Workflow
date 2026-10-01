# Architecture Decision Records

One record per design decision, including decisions that were later replaced. Records are numbered in the order the decisions were made.

New records are written with the `write-an-adr` skill (`.claude/skills/write-an-adr/`), which holds the template and the rules for numbering, provenance and supersession.

Records 0001 to 0055 were written on 2026-09-29, after the fact. Each one states where its reasoning comes from: a document written at the time, a document written later, the owner's words in a saved session, or the owner's memory on the day of asking. The owner ruled on the open findings of those records between 2026-09-29 and 2026-10-01; two decisions made during that review are records 0056 and 0057. A record with a `## Divergence` section describes a decision the code does not currently follow.

Decisions about the internals of `@paysdoc/devplatform` and the depaudit CLI are recorded in those repositories.

| ADR | Decided | Title | Status |
|---|---|---|---|
| [0001](0001-script-per-orchestrator-driving-claude-code-cli.md) | 2026-02-24 | One script per orchestrator, each driving the Claude Code CLI as a subprocess | accepted |
| [0002](0002-worktree-per-issue.md) | 2026-02-24 | One git worktree per issue | accepted |
| [0003](0003-external-target-repo-workspaces.md) | 2026-02-25 | ADW runs from its own repository against target repositories cloned into external workspaces | accepted |
| [0004](0004-cost-records-as-csv-in-git.md) | 2026-02-25 | Cost records as CSV files committed to the ADW repository | superseded by [ADR-0026](0026-cost-computed-locally-persisted-in-d1.md) |
| [0005](0005-adw-directory-config-per-target-repo.md) | 2026-02-26 | Each target repository describes itself in a `.adw/` directory of Markdown files | accepted |
| [0006](0006-global-target-repo-registry.md) | 2026-03-01 | A global registry holds the target repository for the process | superseded by [ADR-0011](0011-provider-ports-and-immutable-repo-context.md) |
| [0007](0007-regex-only-issue-classification.md) | 2026-03-01 | Extract ADW commands and adwId from issue text by regex, not by an LLM | superseded by [ADR-0041](0041-label-based-classification.md) |
| [0008](0008-webhook-endpoint-via-cloudflare-tunnel.md) | 2026-03-04 | Webhook endpoint through a Cloudflare Tunnel, with signed payloads | accepted |
| [0009](0009-bun-as-package-manager-node-as-runtime.md) | 2026-03-06 | Bun is the package manager and launcher; Node is the runtime | accepted |
| [0010](0010-model-and-effort-routing-per-command.md) | 2026-03-06 | Model and reasoning effort are routed per slash command from central tables | accepted |
| [0011](0011-provider-ports-and-immutable-repo-context.md) | 2026-03-09 | Platform access goes through provider ports bound to an immutable RepoContext | accepted |
| [0012](0012-webhook-gatekeeper-cron-sweeper.md) | 2026-03-09 | Webhook as real-time gatekeeper, cron as backlog sweeper | accepted |
| [0013](0013-kpi-tracking-phase.md) | 2026-03-12 | KPI tracking as a phase of the SDLC workflow | superseded by [ADR-0045](0045-kpi-module-removed.md) |
| [0014](0014-bdd-as-validation-contract-unit-tests-removed.md) | 2026-03-13 | BDD scenarios as the validation contract, ADW unit tests removed | accepted, in part superseded by [ADR-0018](0018-unit-tests-restored-alongside-bdd.md) |
| [0015](0015-slash-commands-as-single-spawn-path.md) | 2026-03-16 | Agents are spawned through one function, and their prompt is a slash command | accepted |
| [0016](0016-github-app-identity.md) | 2026-03-17 | ADW acts on GitHub as a GitHub App, not as the owner | accepted |
| [0017](0017-auto-merge-by-webhook-then-orchestrator.md) | 2026-03-18 | Merge approved PRs from the webhook, then also from the orchestrator | superseded by [ADR-0028](0028-orchestrators-stop-at-awaiting-merge.md) |
| [0018](0018-unit-tests-restored-alongside-bdd.md) | 2026-03-19 | Unit tests restored alongside BDD scenarios | accepted |
| [0019](0019-dev-and-main-branches-with-runner-clone.md) | 2026-03-19 | Pipeline work lands on `dev`; the runner executes a separate clone of `main` | accepted |
| [0020](0020-shared-phase-runner-and-core-decomposition.md) | 2026-03-22 | Phases run through a shared phase runner, and the core is split into single-purpose modules | accepted |
| [0021](0021-behavioural-test-harness-with-mocked-boundaries.md) | 2026-03-23 | Behavioural test harness with mocked external boundaries | accepted |
| [0022](0022-review-proof-in-r2-behind-router-worker.md) | 2026-03-24 | Proof images stored in R2 and served by a router Worker | accepted |
| [0023](0023-context-exhaustion-is-a-reset.md) | 2026-03-25 | Context exhaustion restarts the agent with fresh context; git state carries the work over | accepted |
| [0024](0024-tdd-in-build-phase-single-pass-alignment.md) | 2026-03-25 | TDD in the build phase and single-pass plan-scenario alignment | accepted, in part superseded by [ADR-0031](0031-active-test-phase-passive-review-judge.md) |
| [0025](0025-rate-limit-pause-and-resume-queue.md) | 2026-03-26 | A rate-limited workflow pauses into a queue and is resumed by the cron trigger | accepted, in part superseded by [ADR-0055](0055-rate-limit-structured-signals-two-tier-wait.md) |
| [0026](0026-cost-computed-locally-persisted-in-d1.md) | 2026-03-27 | Cost computed locally and persisted in a D1 database | accepted |
| [0027](0027-llm-diff-gate-for-chores.md) | 2026-03-27 | LLM diff gate for chores | accepted |
| [0028](0028-orchestrators-stop-at-awaiting-merge.md) | 2026-04-03 | Orchestrators stop at `awaiting_merge`; the cron spawns a merge orchestrator | accepted |
| [0029](0029-top-level-state-file-as-source-of-truth.md) | 2026-04-03 | One top-level state file per adwId is the source of truth for workflow state | accepted |
| [0030](0030-cloudflare-dns-managed-by-hand.md) | 2026-04-08 | Cloudflare DNS records managed by hand | accepted |
| [0031](0031-active-test-phase-passive-review-judge.md) | 2026-04-08 | Active test phase, passive review judge | accepted |
| [0032](0032-explicit-cancel-and-retry-directives.md) | 2026-04-09 | A human steers a workflow with `## Cancel` and `## Retry` comments | accepted |
| [0033](0033-depaudit-as-dependency-gate.md) | 2026-04-17 | depaudit as the dependency gate for ADW-managed repositories | deferred |
| [0034](0034-coordination-kernel.md) | 2026-04-20 | A coordination kernel: lifetime lock, OS liveness, heartbeat, and takeover reconciled against the remote | accepted |
| [0035](0035-single-host-per-repo.md) | 2026-04-20 | One host runs the triggers for a repo; this is a convention and the code does not enforce it | accepted |
| [0036](0036-stage-taxonomy-and-exhaustive-classifier.md) | 2026-04-20 | Every workflow stage has one recovery class, and the compiler checks that none is missed | accepted |
| [0037](0037-tiered-regression-suite-with-fixed-vocabulary.md) | 2026-04-25 | Tiered regression suite with a fixed vocabulary | accepted |
| [0038](0038-stateless-merge-gate.md) | 2026-04-26 | The merge gate is one stateless rule: no `hitl` label, or an approved PR | accepted |
| [0039](0039-host-wide-auth-gate.md) | 2026-05-13 | An expired Claude login closes a host-wide gate until a human logs in again | accepted |
| [0040](0040-scenario-promotion-by-tag-edit.md) | 2026-05-21 | Scenario promotion by tag edit on the per-issue PR | superseded by [ADR-0049](0049-promotion-sweep-files-human-gated-issue.md) |
| [0041](0041-label-based-classification.md) | 2026-06-08 | Issues are classified by `adw:*` labels; issue text never triggers a workflow | accepted |
| [0042](0042-hash-versioned-self-upgrade.md) | 2026-06-08 | Target repos upgrade themselves when the framework hash changes | accepted |
| [0043](0043-multi-language-test-seam.md) | 2026-06-15 | Multi-language test seam: detected descriptor, Gherkin mandate, JUnit report rail | accepted |
| [0044](0044-living-docs-per-module.md) | 2026-06-17 | One living doc per module, rewritten in place | accepted, in part superseded by [ADR-0053](0053-docs-index-health-gate-and-sweep.md) |
| [0045](0045-kpi-module-removed.md) | 2026-06-17 | KPI module removed | accepted |
| [0046](0046-gitcontext-as-sole-git-authority.md) | 2026-06-19 | GitContext is the only way to run git or gh | accepted |
| [0047](0047-resume-in-place.md) | 2026-06-21 | A recovered workflow continues in its existing worktree when git can still work there | accepted |
| [0048](0048-one-adwid-per-issue-and-review-failed-gate.md) | 2026-06-29 | One adwId per issue, and a failed review blocks the workflow | accepted |
| [0049](0049-promotion-sweep-files-human-gated-issue.md) | 2026-07-08 | Promotion sweep files a human-gated issue for the normal pipeline | accepted |
| [0050](0050-target-repo-guardrails.md) | 2026-07-17 | ADW injects its own guardrails into agent runs on target repositories | accepted |
| [0051](0051-forge-agnostic-core-and-devplatform-dependency.md) | 2026-08-14 | ADW depends on `@paysdoc/devplatform` and contains no forge-specific code | accepted |
| [0052](0052-stateless-pipeline-agents.md) | 2026-08-28 | Pipeline agents never load Claude auto-memory | accepted |
| [0053](0053-docs-index-health-gate-and-sweep.md) | 2026-08-28 | Docs index health is checked by a CI gate and a daily sweep | accepted |
| [0054](0054-comment-discipline.md) | 2026-09-24 | Comments say only what the code cannot | accepted |
| [0055](0055-rate-limit-structured-signals-two-tier-wait.md) | 2026-09-25 | Rate limits are read from structured signals and waited out without limit, in the process or in the queue | accepted |
| [0056](0056-planner-commits-only-the-plan.md) | 2026-10-01 | The planner commits only the plan; `.claude/` and `.adw/` are off-limits to it | accepted |
| [0057](0057-subscription-by-default-api-key-by-choice.md) | 2026-10-01 | The pipeline runs on the Claude subscription by default; an operator may choose API billing by setting the key | accepted |
