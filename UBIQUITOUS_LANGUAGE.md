# Ubiquitous Language

## Workflow orchestration

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Workflow** | A complete execution pipeline that processes a single Issue from classification through documentation | Pipeline, flow, job |
| **Orchestrator** | A TypeScript entry point (`adws/adw*.tsx`) that composes and sequences Phases into a Workflow | Runner, controller, coordinator |
| **ADW ID** | An 8-character unique identifier assigned to a single Workflow execution, used for state tracking, branching, and cost attribution | Session ID, run ID, workflow ID |
| **Phase** | A discrete, high-level operation within a Workflow (e.g., Plan, Build, Test, Review, Document) | Step, stage |
| **Stage** | A granular progress checkpoint within a Workflow, tracked in state files for recovery; follows `{phase}_{action}` naming (e.g., `plan_created`, `build_running`, `test_passed`, `review_passed`) | Status, step, phase |
| **Phase Runner** | The infrastructure that executes Phases with error handling, cost accumulation, and parallel execution support | Executor, dispatcher |

## Issue lifecycle

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Issue** | A unit of work to be processed, regardless of platform (GitHub Issue, Jira issue, GitLab issue) | Work item, ticket, task, card |
| **Issue Type** | The classification of an Issue as one of `/feature`, `/bug`, `/chore`, or `/pr_review`, determining which Orchestrator handles it | Category, kind, label |
| **Classification** | The process of determining an Issue's Issue Type, either by regex-matching an explicit ADW Command or by AI-based heuristic | Triage, routing |
| **ADW Command** | An explicit slash command (e.g., `/adw_sdlc`, `/adw_plan_build`) embedded in an Issue that overrides Issue Type routing to select a specific Orchestrator | Override command, explicit command |

## Agents

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Agent** | A Claude Code CLI subprocess that executes a specific task within a Phase (e.g., Plan Agent, Build Agent, Review Agent) | Worker, process, bot |
| **Agent State** | A JSON file (`agents/{adwId}/{agentName}/state.json`) tracking an Agent's execution status, output, and metadata | Agent log, agent record |
| **Agent Result** | The return value from an Agent execution, containing success status, output text, cost data, and error flags | Agent response, agent output |

## Planning and building

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Plan** | A structured implementation specification generated from an Issue, committed as `{adwId}_plan_spec.md` | Spec, design doc, blueprint |
| **Build** | The Phase where code changes are implemented based on a Plan; the `/implement` or `/implement-tdd` command executes within it | Implementation phase, development phase, coding phase |
| **TDD Mode** | An automatic Build variant activated when BDD Scenarios tagged with the Issue's number exist, using `/implement-tdd` with red-green-refactor | Test-first mode |
| **Patch** | A targeted code fix applied by the Patch Agent to resolve Blockers found during Review | Hotfix, quick fix |

## Testing and quality

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Scenario** | A BDD test written in Gherkin syntax (`.feature` file), tagged with `@adw-{issueNumber}` to link it to an Issue | Test case, spec, acceptance test |
| **Step Definition** | The executable implementation of a Gherkin step (Given/When/Then) | Step implementation, glue code |
| **Scenario Proof** | The execution of tagged Scenarios during Review to validate that the implementation satisfies behavioral requirements | Scenario run, BDD proof |
| **Plan Validation** | A multi-round process comparing Plan behaviors against Scenario coverage, using Validation and Resolution Agents to reconcile mismatches | Plan check, plan verification |
| **Alignment** | A single-pass reconciliation of Plan and Scenarios that flags unresolvable conflicts as warnings rather than halting | Sync, reconciliation, validation (when single-pass is meant) |
| **Review** | A Phase where up to three parallel Review Agents validate the implementation against the Plan, run Scenario Proofs, and capture screenshots | Code review, inspection |
| **Blocker** | A Review finding severe enough to prevent merging; triggers the Patch Agent for auto-resolution | Critical issue, showstopper |
| **Tech Debt** | A Review finding logged for future attention but not blocking merge | Warning, non-critical issue |

## Version control

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Worktree** | An isolated git workspace (`.worktrees/{branchName}/`) created for a single Issue to enable concurrent processing | Workspace, sandbox, checkout |
| **Branch** | A git branch following the convention `{prefix}-{issueNumber}-{adwId}-{slug}`, where prefix derives from Issue Type | Feature branch |
| **Pull Request** | A request to merge a Branch into the default branch, regardless of platform (GitHub PR, GitLab MR, Bitbucket PR) | Merge request, MR |

## Cost tracking

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Token Usage** | A breakdown of tokens consumed by type: `input`, `output`, `cache_read`, `cache_write` | Token count, consumption |
| **Model Usage** | Token Usage grouped by model identifier (e.g., `claude-opus-4-5`, `claude-sonnet-4`) | Model breakdown |
| **Phase Cost Record** | A per-model, per-Phase record of token consumption, computed cost, duration, retry count, and context reset count | Cost entry, billing record |
| **Cost Divergence** | A significant discrepancy between locally computed cost and CLI-reported cost, flagged when exceeding a threshold | Cost mismatch |

## Providers and platforms

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Platform** | A code hosting service: `github`, `gitlab`, or `bitbucket` | Host, service, provider |
| **Code Host** | The platform-agnostic interface for repository and Pull Request operations | VCS provider, git host |
| **Issue Tracker** | The platform-agnostic interface for Issue retrieval, commenting, and status transitions | Ticket system, project tracker |
| **Repo Context** | An immutable bundle of Issue Tracker, Code Host, working directory, and Repo Identifier passed through the Workflow | Provider context, platform context |

## Recovery and error handling

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Recovery State** | Persisted checkpoint data (last completed Stage, ADW ID, branch, plan path, PR URL) enabling Workflow resumption | Resume state, checkpoint |
| **Context Overextension** | The condition where an Agent's context has grown beyond useful limits, manifesting as either Compaction or Token Limit | Context overflow, memory pressure |
| **Compaction** | A symptom of Context Overextension where Claude Code proactively compresses the conversation, degrading context quality; the Agent keeps running but with reduced fidelity | Context compression, context truncation |
| **Token Limit** | A symptom of Context Overextension where the context window is exhausted, forcibly stopping the Agent; no further work is possible in that session | Context overflow, max tokens, token exhaustion |
| **Context Reset** | The remedy for Context Overextension: restart the Agent step from a clean context, tracked as a count (`contextResetCount`) that does NOT increment the Retry counter | Continuation, auto-resume, extension |
| **Retry** | A logical re-attempt of a Phase after failure (e.g., test failure, review Blocker), tracked separately from Context Resets | Re-run, re-execution |
| **Pause** | A Workflow suspension triggered by rate limits or billing limits, detected and resumed by the Pause Queue Scanner | Suspend, halt, throttle |

## Configuration

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Project Config** | The collection of `.adw/` files in a target repository that configure ADW behavior for that project | Settings, project settings |
| **Commands Config** | The `.adw/commands.md` file mapping build/test/lint/install commands for a target project | Build config, toolchain config |
| **Review Proof Config** | The `.adw/review_proof.md` file defining which Scenario tags and supplementary checks are required during Review | Review rules, review config |

## Relationships

- A **Workflow** is identified by exactly one **ADW ID** and processes exactly one **Issue**
- An **Orchestrator** composes one or more **Phases** into a **Workflow**
- A **Phase** progresses through multiple **Stages** and spawns one or more **Agents**
- An **Issue** is assigned an **Issue Type** through **Classification**
- An **ADW Command** overrides **Issue Type** routing to select a specific **Orchestrator**
- A **Build** operates in **TDD Mode** when **Scenarios** tagged with the Issue's number exist
- A **Review** produces **Blockers** (auto-fixed by **Patch**) and **Tech Debt** (logged only)
- **Plan Validation** is multi-round; **Alignment** is single-pass -- both reconcile **Plans** with **Scenarios**
- **Context Overextension** manifests as **Compaction** (quality degradation) or **Token Limit** (hard stop); both are remedied by **Context Reset**
- A **Context Reset** does NOT increment the **Retry** counter -- they are independent tracking dimensions
- A **Phase Cost Record** belongs to exactly one **Phase** and one model within a **Workflow**
- A **Repo Context** bundles an **Issue Tracker** and **Code Host** for a single **Platform**
- Each **Workflow** operates in its own **Worktree** on a dedicated **Branch**

## Example dialogue

> **Dev:** "When a new Issue comes in, how does ADW decide what to run?"
>
> **Domain expert:** "First, Classification examines the Issue for an explicit ADW Command. If it finds `/adw_sdlc`, that directly selects the SDLC Orchestrator. If no command is found, it falls back to AI-based Classification to determine the Issue Type -- `/feature`, `/bug`, `/chore`, or `/pr_review` -- and the Issue Type maps to a default Orchestrator."
>
> **Dev:** "So a `/feature` and a `/bug` both route to the SDLC Orchestrator?"
>
> **Domain expert:** "Yes. The SDLC Orchestrator runs the full pipeline: Install, Plan and Scenario in parallel, then Alignment, Build, Test, Review, Document. A `/chore` routes to Plan-Build only -- fewer Phases."
>
> **Dev:** "What's the difference between Plan Validation and Alignment?"
>
> **Domain expert:** "Plan Validation is multi-round. The Validation Agent compares the Plan against tagged Scenarios, and if there are mismatches, the Resolution Agent tries to fix them -- up to a retry limit. Alignment is a single-pass alternative: one Agent reads both, reconciles what it can, and flags the rest as warnings without halting."
>
> **Dev:** "If the Build Agent hits the token limit mid-build, does that count as a Retry?"
>
> **Domain expert:** "No. That's Context Overextension -- specifically a Token Limit. The remedy is a Context Reset: restart the Agent step from a clean context. It doesn't increment the Retry counter. A Retry only happens on a logical failure, like when tests fail or Review finds Blockers. The Phase Cost Record tracks both dimensions separately."
>
> **Dev:** "What about Compaction? Is that the same thing?"
>
> **Domain expert:** "Same remedy -- Context Reset -- but a different symptom. Compaction means Claude Code proactively compressed the conversation. The Agent kept running but with degraded context. Token Limit means the Agent was forcibly stopped. Both are Context Overextension, both get a Context Reset, but they tell you different things about the Workflow's health."

## Resolved ambiguities

These ambiguities were identified and resolved. The resolutions are reflected in the glossary above. This section documents the decisions for future reference.

- **"Phase" vs "Stage"** (resolved): Distinct hierarchy levels. **Phase** = high-level operation (Plan, Build, Test). **Stage** = granular checkpoint (e.g., `plan_created`, `build_running`). Stages follow `{phase}_{action}` naming. Code change required: rename `implementing` → `build_running`, `implemented` → `build_completed`, `implementation_committing` → `build_committing`.

- **"Build" vs "implement"** (resolved): **Build** is the canonical Phase name. `/implement` and `/implement-tdd` are the slash commands that execute within the Build Phase. Avoid saying "implementation phase."

- **"Issue" vs "Work Item"** (resolved): **Issue** is the universal term. `WorkItem` type to be renamed to `Issue` in provider layer. All platforms ADW supports (GitHub, GitLab, Jira) use "issue" natively.

- **"PR" vs "Merge Request"** (resolved): **Pull Request** is the universal term. `MergeRequest` type to be renamed to `PullRequest`, `CreateMROptions` → `CreatePROptions`, `MergeRequestResult` → `PullRequestResult`. "PR" is acceptable shorthand.

- **"Retry" vs "Continuation"** (resolved): Distinct mechanisms. **Retry** = logical failure re-attempt. **Context Reset** = recovery from Context Overextension. `continuationCount` to be renamed to `contextResetCount`.

- **"Validation" vs "Alignment"** (resolved): Distinct approaches. **Plan Validation** = multi-round with hard failure. **Alignment** = single-pass with warnings. Fix vocabulary in generated `app_docs/` to use terms precisely.

- **"Compaction" vs "Token Limit"** (resolved): Both are symptoms of **Context Overextension**. **Compaction** = proactive context compression (quality degradation). **Token Limit** = hard context exhaustion (forced stop). Same remedy: **Context Reset**. New umbrella term "Context Overextension" introduced.
