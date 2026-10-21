# ADW Init via Content Hash + Label-Based Classification

## Problem Statement

The current ADW framework has two operational pain points that compound each other:

**1. The `/adw_init` regex trigger misfires.**
`/adw_init` is matched in issue bodies and comments by `extractAdwCommandFromText` (in `core/issueClassifier.ts`), which iterates over the keys of `adwCommandToIssueTypeMap` — a map that includes `'/adw_init': '/adw_init'`. Any issue author who writes `/adw_init` in prose without backticking it accidentally triggers an init workflow on a target repo. The same failure class theoretically affects orchestrator-level commands like `/adw_sdlc` or `/adw_plan_build_test`, though these are less commonly typed in unrelated prose.

**2. There is no propagation of framework changes to target repos.**
When the framework's `/adw_init.md` spec or its dependencies (e.g., `templates/vocabulary.md.template`) are updated, target repos that already have a generated `.adw/` directory do not pick up the new behavior. The operator has to remember each target repo and manually re-trigger `/adw_init` on each one. This is invisible toil; target repos go silently stale, and the operator cannot trust that "all my targets are using the current framework version" without manually auditing.

Separately, the classification path that routes new issues to a workflow (`/feature`, `/bug`, `/chore`, `/pr_review`) currently depends on the LLM reading issue body content seeded by slash-command markers. This shares the same regex-misfire failure class — `/feature` in unrelated prose can produce misclassification.

## Solution

Replace the comment-regex `/adw_init` trigger with a **versioned auto-(re)init system** keyed on a deterministic content hash of `/adw_init.md` and its explicitly-declared file dependencies. Every orchestrator that runs on a target repo compares the framework's current hash against a value the target last initialized with (stored in `.adw-version` at the target repo root). On mismatch, the orchestrator atomically claims a dedicated upgrade branch, creates a tracking issue tagged `adw:upgrade`, and a single-purpose orchestrator (`adwUpgrade.tsx`) does the actual regeneration and opens a PR (auto-merged by default). All in-flight issues that detected the same mismatch are pushed back to the Todo lane and given a dependency on the upgrade issue; existing CRON-based dependency-closure resolves them when the upgrade PR merges.

Concurrently, replace body-slash-command classification with **label-based classification**. Every new issue triggers ADW on `issues.opened` (no per-issue opt-in); classification is driven by an `adw:*` label in the payload. An `adw:none` label opts the issue out entirely. The LLM classifier runs only as a fallback when no classification label is present at creation. Labels added after creation have no effect; the existing CRON recovery layer rescans for eligibility.

The result: `/adw_init` is no longer a regex trigger anywhere in the code; framework updates propagate automatically to every target repo the next time any work runs on them; the entire body-regex misfire class is eliminated for classification.

## User Stories

1. As the framework operator, I want target repos to automatically pick up changes to `/adw_init.md` the next time any issue runs on them, so that I never need to remember to manually re-init each target after a framework change.
2. As the framework operator, I want to update the framework's init spec without performing manual operations on every downstream target repo, so that my changes propagate at the natural cadence of work.
3. As the framework operator, I want a clear list of file dependencies for `/adw_init.md` declared in the spec itself, so that adding a new dependency is impossible to forget — the same PR that adds it updates the hash inputs.
4. As an issue author on a target repo, I want my issues to be processed by ADW without typing slash commands in the body, so that I cannot accidentally trigger a misclassification by mentioning `/feature` in prose.
5. As an issue author, I want to label an issue `adw:none` and have ADW skip it entirely, so that bug-report-for-triage and discussion-thread issues are not processed.
6. As a triager, I want to apply a label like `adw:bug` at issue creation and have ADW skip the LLM classifier, so that I can override classification when the LLM would get it wrong.
7. As the framework operator, I want the upgrade work to happen as its own tracking issue with its own PR, so that the upgrade has a normal review lifecycle and shows up in the project board.
8. As the framework operator, I want the upgrade PR to auto-merge by default, so that target repos stay current without my intervention.
9. As the framework operator, I want to opt in to human review of upgrade PRs per target repo via a config file outside `.adw/`, so that the LLM regen of `.adw/` cannot clobber the opt-in signal.
10. As the framework operator, I want all in-flight issues on a target repo to wait politely for an upgrade to complete, so that none of them processes against a stale `.adw/`.
11. As the framework operator, I want concurrent upgrade attempts (when multiple issues hit the same hash mismatch simultaneously) to resolve to a single upgrade PR, so that I never see duplicate upgrade issues or wasted LLM regen work.
12. As the framework operator, I want stuck or failed upgrades to be visibly attached to their tracking issue, so that the team's feature issues stay clean of upgrade-failure noise.
13. As the framework operator, I want my orchestrator workers' slots to free immediately when an issue is parked waiting for upgrade, so that throughput recovers when the upgrade lands.
14. As the framework operator, I want to manually trigger `/adw_init` from inside a Claude Code CLI session against a target repo, so that I retain an escape hatch for ad-hoc regeneration.
15. As the framework operator, I want issues that are stuck due to multi-label conflicts to self-recover when the labels are cleaned up, so that I do not have to delete-and-recreate broken issues.
16. As the framework operator, I want a single `adw:upgrade` label to identify upgrade-tracking issues, so that I can find them at a glance on the project board.
17. As the framework operator, I want labels created automatically the first time ADW interacts with a new target repo, so that I do not have to pre-create labels by hand on every target.
18. As the framework operator, I want labels lazy-recreated if a human accidentally deletes them, so that ADW does not silently break on label-not-found errors.
19. As the framework operator, I want classification to read labels first and fall back to LLM inference only if no label is present, so that label intent is honored without LLM intermediation.
20. As the framework operator, I want the LLM-inferred classification to be persisted as a label on the issue, so that every issue's classification is visible on the board even when humans did not label it.
21. As the framework operator, I want issues with multiple `adw:<type>` labels at creation to be refused with a clear comment, so that I am not silently guessing which type the human meant.
22. As the framework operator, I want failed-init LLM errors to surface as a non-workflow comment on the upgrade tracking issue, so that the failure is visible without polluting the concurrency-count.
23. As the framework operator, I want existing target repos to be onboarded by a clean cutover (no migration shim), so that the regex-misfire class is eliminated immediately and not lingering during a transition window.
24. As the framework operator, I want orchestrator-level commands (`/adw_sdlc`, `/adw_plan_build_test`, etc.) to lose their body/comment invocation path, so that the entire body-regex misfire class is eliminated for both classification and orchestrator routing.
25. As the framework operator, I want target repos that have never been initialized to be treated identically to repos with a hash-mismatch upgrade, so that there is no separate bootstrap code path.
26. As the framework operator, I want hash recomputation to happen at the upgrade orchestrator's runtime, so that the upgrade lands at whatever hash is current — not a stale claim from minutes earlier.
27. As the framework operator, I want recursive churn when the framework hash advances during a slow HITL upgrade to be accepted (rather than designed-around), so that the system stays simple and the recursive case is rare enough to tolerate in practice.
28. As the framework operator, I want the webhook to subscribe to `issues.opened` only and rely on the existing CRON recovery layer for late-applied labels, so that the trigger plumbing is minimal and recovery is unified with existing dependency-closure handling.
29. As the framework operator, I want pre-existing open issues (created before this redesign) to be unprocessable until manually re-created, so that I am not silently surprised by ADW activity on historic issues.
30. As the framework operator, I want the legacy `adwInit.tsx` orchestrator removed once its responsibilities are absorbed by `adwUpgrade.tsx`, so that the orchestrator inventory stays minimal.

## Implementation Decisions

### Hash computation
- The framework's current hash is a SHA256 over the byte content of `/adw_init.md` plus the files listed in a new `hashInputs:` frontmatter field on `/adw_init.md`. Today's set: `.claude/commands/adw_init.md`, `templates/vocabulary.md.template`.
- The hash is computed by a pure deep module that reads frontmatter, resolves the file list, concatenates bytes, and returns the digest.
- No CI guardrail or semantic-hash machinery is added; content hash is the contract.

### Hash storage on target repos
- Each target repo carries a `.adw-version` file at the repo root containing the plain SHA256 + trailing newline. No metadata.
- The file lives outside `.adw/` so the LLM regen cannot clobber it (mirrors the rationale for keeping the HITL opt-in in `.github/adw.yml`).
- Absent file is treated as `null`; "no `.adw-version`" composes naturally with "hash mismatch with N/A on one side," collapsing first-bootstrap and upgrade into a single code path.

### Hash check in `initializeWorkflow()`
- Inserted after worktree setup, before classification (in the current file flow, between the worktree-setup block and the classification block at the existing line that calls `classifyGitHubIssue`).
- On match: proceed to classification and the rest of the existing flow.
- On mismatch: invoke the upgrade-claim primitive. If A wins the claim → A creates the `adw:upgrade` tracking issue, invokes the new orchestrator, registers the current issue's dependency on the tracking issue, returns the current issue to the Todo lane, exits cleanly. If A loses the claim → A finds the existing tracking issue, registers dependency on it, returns to Todo, exits.
- `adwMerge.tsx` is exempt — it does not call `initializeWorkflow()` and continues to read state directly.

### Upgrade claim primitive
- Atomic race uses GitHub's branch namespace as the only primitive that gives create-if-not-exists semantics across distributed orchestrators.
- A orchestrator: `git commit --allow-empty -m "ADW upgrade in progress: <hash>"` on a new branch named `adw-upgrade-<hash>`, then `git push origin adw-upgrade-<hash>`. Push success = winner. Push failure (branch exists) = loser.
- Loser path: query for the open issue with the `adw:upgrade` label tied to this hash (PR linked to the branch → issue), register dependency, exit.
- Branch name is a claim token only; `.adw-version` content is computed fresh by the upgrade orchestrator at runtime, so the branch name may drift from final content if framework hash advances during the gap. The Q32 recursive-churn behavior absorbs this.

### `adwUpgrade.tsx` orchestrator
- Joins the `adwMerge.tsx` exception list — does not call `initializeWorkflow()`, no recursive-spawn guard needed by construction.
- Minimal worktree setup: clone/fetch target repo to a worktree, checkout the `adw-upgrade-<hash>` branch (where A's empty claim commit lives).
- Runs `/adw_init.md` via Claude CLI against the target repo's worktree.
- Recomputes the framework hash at runtime (fresh, not from A's claim).
- Commits the regenerated `.adw/` directory and writes the freshly-computed hash to `.adw-version`. PR shows two commits: A's empty claim + adwUpgrade.tsx's regen.
- Opens a PR linking the `adw:upgrade` tracking issue. PR auto-merges by default; opt-in HITL is signaled by `.github/adw.yml` on the target repo.
- On LLM failure during regen: post a non-workflow comment (no ADW marker) to the tracking issue with the error reason. Workflow exits. The concurrency guard does not count this as in-progress.
- The legacy `adwInit.tsx` orchestrator is deleted.

### Tracking issue (`#UPG`)
- Created by A with `adw:upgrade` label applied.
- Hash is embedded in the branch name; the tracking issue does not need to carry the hash explicitly (label routes; branch carries the version).
- A and any losing orchestrators (B/C/D) register a dependency on the tracking issue using the existing dependency system.
- When the tracking issue closes (PR merges → issue auto-closes via standard "Implements #N" linkage), the existing CRON-driven dependency-closure unblocks the dependent issues. Each unblocked orchestrator re-enters `initializeWorkflow()`; hash now matches; normal flow resumes.
- Multi-label refusal and `adw:none` opt-out do not apply to `#UPG` — it is created with exactly one `adw:upgrade` label.

### Label-based classification
- Six labels per target repo: `adw:chore`, `adw:bug`, `adw:feature`, `adw:pr_review`, `adw:upgrade`, `adw:none`.
- Colon-prefix namespace (`adw:type`) follows GitHub-idiomatic label scoping.
- Webhook subscribes to `issues.opened` only. `issues.labeled` events are NOT subscribed. Labels added after creation have no immediate effect; the CRON recovery layer rescans periodically and picks up newly-eligible issues.
- Routing in the `issues.opened` handler:
  - `adw:none` present → ignore (no orchestrator spawned).
  - Exactly one `adw:<type>` label → use it as classification; skip LLM inference.
  - Zero `adw:<type>` labels → run LLM classifier per the existing `classifyGitHubIssue` behavior; apply the inferred label to the issue.
  - Multiple `adw:<type>` labels → refuse to process; post a non-workflow comment requesting the team remove all but one. Issue remains eligible for CRON rescan; reduces to zero or one label → eligible.

### Trigger plumbing
- `issues.opened` is the only webhook event added for invocation.
- `extractAdwCommandFromText` and `classifyWithAdwCommand` are deleted from `core/issueClassifier.ts`. The two-step classify path collapses to LLM-only.
- `adwCommandToIssueTypeMap` retains its other uses (orchestrator routing) but the `/adw_init` entry is removed.
- Orchestrator-level commands (`/adw_sdlc`, `/adw_plan_build_test`, etc.) lose body/comment invocation entirely. Power-user invocation is via CLI (`bunx tsx adws/<orchestrator>.tsx <issueNumber>`) or via labels.
- Existing comment-trigger workflow control (`## Continue`, `## Cancel`, `## Retry`) is unchanged. Those are heading-based markers, not slash-based, and live in `core/workflowCommentParsing.ts`.

### CRON recovery layer
- `trigger_cron.ts` extends to scan known target repos for `adw:*`-labeled issues without orchestrator state.
- Eligibility rule: open issue with exactly one `adw:<type>` label, no `adw:none`, no in-progress ADW comment, no linked merged/closed PR.
- Inherits the existing cron+webhook dedup race noted in the project memory; existing dedup primitive (orchestrator-existence check at spawn time) extends to cover label-eligibility scans.

### Label lifecycle management
- New deep module `labelManager`.
- On first webhook from any target repo: pre-create all six `adw:*` labels via `gh label create` (idempotent — no-op if exists).
- On any label-apply that fails with "not found": lazy-create the label then retry. Resilient to human deletion.

### Concurrency interaction
- The hash check at `initializeWorkflow()` happens BEFORE the workflow's first claim comment posts. A failed bootstrap or upgrade does not consume a concurrency slot. Failed-init's loud-fail comment is a non-workflow comment (no ADW marker), so `concurrencyGuard.ts:80`'s `isAdwComment` check does not count it.
- A/B/C/D, when they push themselves back to Todo with a dependency on `#UPG`, exit before any workflow comment posts. Slots free immediately.

### Manual escape hatch
- `/adw_init.md` the slash-command file is preserved unchanged (apart from the new `hashInputs:` frontmatter). It remains invokable inside a Claude Code CLI session against any target repo.
- The orchestrator wrapper `adwInit.tsx` is deleted.

## Testing Decisions

### Testing philosophy
- Test external behavior only — what callers observe. Do not test internal data structures or private helpers.
- Each test should isolate one module by providing real inputs and asserting on real outputs.
- Prefer pure-function tests where possible; for I/O-touching modules, use fixture directories.

### Modules with test coverage

**`hashComputer`**
- Given a fixture `/adw_init.md` with a known `hashInputs:` list and known file content, returns a known SHA256.
- Changing any byte in any listed input file changes the hash.
- Reordering files in `hashInputs:` does NOT change the hash (the module normalizes order or the spec defines a canonical order — TBD by implementation).
- Missing `hashInputs:` frontmatter is an error (hard fail; signals operator misconfiguration).
- Missing referenced file is an error.
- Prior art: similar fixture-driven hashing tests likely exist for state-file hashing or similar in `core/` — check `core/__tests__/` for patterns.

**`adwVersion`**
- `readAdwVersion(worktreePath)` returns the trimmed SHA when `.adw-version` exists.
- `readAdwVersion(worktreePath)` returns `null` when the file does not exist.
- `writeAdwVersion(worktreePath, hash)` writes the hash followed by a single newline; subsequent `readAdwVersion` returns the same hash.
- Trailing whitespace and stray newlines in existing `.adw-version` are tolerated on read.

**`upgradeClaim`**
- Simulates a target repo (local fixture or test repo) and confirms that an empty claim commit + branch push succeeds when the branch is absent.
- Confirms push failure when the branch already exists, and that the loser path correctly returns an `existingIssueNumber` and `existingBranch`.
- Two concurrent claim attempts result in exactly one winner; the loser sees the winner's branch in its lookup.
- Note: this module depends on a real GitHub remote for true atomic-race testing; unit tests can mock the remote, integration tests should use a sandbox repo.

**`labelManager`**
- `ensureAdwLabelsExist(repoInfo)` is idempotent — running it twice does not produce errors.
- `applyLabel(issueNumber, label, repoInfo)` succeeds when the label exists.
- `applyLabel(...)` on a missing label triggers lazy-create and succeeds on retry.
- `readAdwLabels(issue)` returns the correct shape for each Q26/Q27/Q28 case: zero/one/multiple `adw:<type>` labels, with-and-without `adw:none`.

### Modules NOT tested in isolation
- `adwUpgrade.tsx` is shallow composition (worktree setup + LLM call + commit + push + PR open). Integration-level smoke testing only.
- Modifications to `initializeWorkflow()`, `trigger_webhook.ts`, `trigger_cron.ts`, and `issueClassifier.ts` are tested at the integration level via end-to-end fixture issues. Unit-testing these modifications in isolation would duplicate the deep-module tests above.

## Out of Scope

- Migration of pre-existing open issues that used body-slash-command classification. Per Q33(a), this is a clean break — operator manages cutover by closing-and-recreating any old issue they want processed. No migration script, no transition shim.
- Auto-promotion bot that converts body slash-commands to labels at issue creation. Same reason as above.
- Moving orchestrator-level commands (`/adw_sdlc`, `/adw_plan_build_test`, etc.) to labels. Out of scope; deletion of body-regex invocation is the only change. Power users invoke via CLI or labels going forward.
- Confidence threshold or pre-classification filtering of LLM classifier (Q27 (b)/(c)). Today's classifier behavior is preserved unchanged for the no-label case.
- CI guardrail that asserts hash stability against a fixture (Q16 (d)/(e)). Content hash is the contract.
- Reproducible upgrade against a pinned framework hash (Q35 (a)). adwUpgrade.tsx always uses the current framework state.
- Webhook subscription to `issues.labeled`. Late-applied labels rely on CRON recovery.
- Depaudit setup propagation. Explicitly excluded by the operator earlier; depaudit is still WIP.
- Per-target-repo configurable label prefix. The fixed `adw:` namespace is sufficient given the sole-operator context.

## Further Notes

### Significant policy shifts vs. today

- **Every new issue triggers ADW** (per Q25(i)). Today, ADW only processes issues that had a slash-command marker. Under the new design, ADW touches every new issue on every target repo, with `adw:none` as the explicit opt-out. This is a real behavior change; documented as a known consequence accepted by the sole operator.
- **Orchestrator-level commands lose body invocation** (per Q37(b)). Power users invoke orchestrators directly via CLI (`bunx tsx adws/<orchestrator>.tsx`) or via labels. No body/comment slash-command match path remains.
- **Pre-existing issues are dead-ends** (per Q33(a)). The cutover is intentionally clean; legacy issues require close-and-recreate to be processed.

### Recursive-churn behavior

When the framework hash advances during an open `#UPG` PR, new orchestrators detecting a still-stale `.adw-version` will attach to the existing `#UPG` (per Q32(a)). When `#UPG` merges, dependents unblock, re-enter `initializeWorkflow()`, detect the further-advanced framework hash, and create a follow-on `#UPG`. This recursive churn is accepted as the cost of avoiding more complex linearization. In practice, with auto-merge as the default and HITL as the opt-in exception, the churn window is short.

### Failure modes and operator action

- **LLM regen fails on `adwUpgrade.tsx`**: non-workflow comment on `#UPG` with the error; operator inspects, restarts the upgrade orchestrator manually if needed (CLI invocation).
- **PR auto-merge blocked by branch protection or required CI**: `#UPG` PR sits open; A/B/C/D wait. Operator either expedites the PR or accepts the wait. This is the "team's responsibility" path (per Q19 reasoning, with the sole-operator caveat that the operator IS the team).
- **Concurrent `#UPG` creation race**: impossible by construction (branch-namespace atomic primitive at Q31(a)).
- **Stuck multi-label issue**: CRON recovery layer waits for labels to drop to ≤1 `adw:<type>`; issue resumes eligibility automatically.

### Files to delete

- `adws/adwInit.tsx` — orchestrator removed; slash-command file `.claude/commands/adw_init.md` preserved.
- `extractAdwCommandFromText` and `classifyWithAdwCommand` functions in `core/issueClassifier.ts`.
- The `/adw_init` entries in `adwCommandToIssueTypeMap` and any related routing maps in `types/issueRouting.ts`.

### Concurrent design exercise outcome

This PRD is the synthesis of an extended Socratic design grilling (~37 substantive questions over two sessions). Most of the non-obvious decisions are documented inline in the Implementation Decisions section. Where a decision references "Q<N>" in the Further Notes, that maps to the corresponding grilling-session question that produced the choice — relevant only as design provenance, not as an artifact to maintain.
