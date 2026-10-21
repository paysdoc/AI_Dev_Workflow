---
status: accepted
date: 2026-10-20
recorded: 2026-10-21
provenance:
  - kind: contemporaneous
    source: docs/prd/specs-worktree-only-and-docs-relocation.md (PR #1075, 2026-10-20)
  - kind: transcript
    source: "Claude Code session f73f1e50, grill of 2026-10-20"
supersedes: ["0056"]
superseded-by: []
---

# `specs/` is a worktree-only working directory; decision records and PRDs live in `docs/`

## Context and Problem Statement

Every ADW run wrote its implementation plan under `specs/` and committed it to the branch; every review patch wrote a patch note there, which the commit command's `git add -A` swept in. Nothing ever deleted either. By 2026-10-20 `specs/` held 838 tracked files (504 plans, 248 patch notes, 65 ADRs, 20 PRDs, one runbook, one stray grill note), 18 MB, with no deletion in its history.

No phase reads a plan after its pull request merges. During a run, build, validation, alignment, review, patch, document, PR and merge hand the plan to one another by path in the worktree. The GitHub issue holds only the first 2,000 characters of the plan, which in practice is the metadata block.

The cost was paid on every agent spawn: the prime command runs `git ls-files`, and `specs/` was 53% of that listing's bytes, roughly 17,000 tokens of dead file names in every primed agent, in this repository and in every target repository. The records that deserve to live forever, the ADRs and PRDs, sat in the same directory as the noise.

The decision covers where plans and patch notes live and for how long, where ADRs and PRDs live, how the ignore reaches a repository, and what a resumed workflow does when its plan is gone.

## Decision Drivers

* Context cost per primed agent, in every repository ADW runs on.
* The pipeline host runs main while branches target dev, so any change to what the plan phase commits must reach the host atomically with any change to what git ignores.
* The docs-index gate holds every `Decisions:` entry in app_docs to a record file, so the record directory must stay tracked and the gate must know where it moved.
* The living-docs cleanup of `app_docs/` (#810) had shown that a periodic sweep works and that manual pruning does not.

## Considered Options

Lifetime of plans and patch notes:

* Keep committing plans; delete merged issues' plans by a cron sweep that opens one chore PR per cadence.
* Keep committing plans; the pipeline deletes its own plan in a final commit before the PR.
* Keep committing plans; prune by hand.
* Never commit plans: `specs/` is ignored and plans exist only in the worktree.

Archive of plans once uncommitted:

* None beyond the existing 2,000-character comment summary.
* Post the full plan as issue comments, chunked at GitHub's 65,536-character cap (31 of 504 plans exceeded it).
* Keep committing after all.

Parent for ADRs and PRDs:

* `docs/adr/` and `docs/prd/`.
* `app_docs/adr/` and `app_docs/prd/`.
* `design/adr/` and `design/prd/`.

Delivery of the ignore:

* Appended to the tracked `.gitignore` by the worktree setup at runtime, landing once per repository in the first PR after release.
* `.git/info/exclude` on the host, never committed.
* A static `.gitignore` line committed to dev.

Resume when the worktree, and with it the plan, was removed:

* Park with a reason naming the lost worktree.
* Re-run the planner silently.

## Decision Outcome

Chosen: never commit plans; no archive; `docs/` parent; runtime ignore; park on a lost plan.

* `specs/` stays the directory the planner writes into, inside the worktree, and git ignores it. The plan phase no longer commits anything. The patch agent returns its patch in its response and writes no file. The pull request body no longer links the plan, and conflict resolution no longer looks for a plan in the incoming branch.
* Nothing archives a plan after the run. The owner's reasoning: no plan had ever been read after merge, and chunked comments would bloat every issue the resume parser scans.
* ADRs move to `docs/adr/` and PRDs to `docs/prd/`, chosen over `app_docs/` so the records do not interact with the living-docs sweep, whose feature-doc rule matches only files directly under `app_docs/`. The 504 plans, 248 patch notes, the runbook and the stray note were deleted in one sweep. Links in closed issues to the old paths were left as they are.
* The ignore ships only through the worktree setup's existing idempotent append helper. The reason is the host: `git add` of an ignored path exits 1 (reproduced in a scratch repository during the grill) and the plan-only commit helper used a plain `git add`, so a static `specs/` line on dev ahead of a release would have failed every run until the release. Shipping the ignore in the same code that stops committing the plan makes the two atomic. A tracked `.gitignore` entry was preferred over `.git/info/exclude` because the owner wanted the ignore visible to anyone reading the repository.
* A resumed workflow whose plan is missing parks with its own reason; the planner is never re-run implicitly, because a second plan written against partially built code would drift from it. Mid-flight worktree removal happens only on cancel, where a restart is expected anyway.

### Consequences

* Good, because every primed agent's file listing loses hundreds of dead paths, in every repository ADW runs on.
* Good, because `specs/` in a worktree now shows exactly the runs in flight on that machine.
* Good, because decision records and PRDs sit apart from working files under one durable parent.
* Bad, because a plan is unrecoverable once its worktree is gone. The 2,000-character comment summary is the only trace.
* Bad, because the pull request no longer shows the plan in its diff; a reviewer who wants it reads the worktree or the comment summary.
* Bad, because the record move and the host release had to land the same day: the docs-index sweep runs the host's code against dev's content, and the old code hardcoded `specs/adr/`.

### Confirmation

Checked on 2026-10-21 on dev at the merge of #1085:

* `git grep commitPlanFileOnly -- adws` finds nothing; the plan-only commit helper and its guard are gone (#1077).
* `adws/phases/worktreeSetup.ts` exports `SPECS_GITIGNORE_ENTRY = 'specs/'` and appends it through the existing helper (#1077).
* `adws/core/docsDecisions.ts` derives the record directory from `DECISION_RECORD_DIR = 'docs/adr'`; `bun run lint:docs-index` passes with every `Decisions:` entry resolving there (#1076).
* `features/regression/plan-commit/feature-930.feature` holds one scenario, down from nine.
* `.claude/commands/patch.md` forbids writing a file; `pull_request.md` forbids naming a `specs/` path; `resolve_conflict.md` searches only the worktree's `specs/` (#1079).
* `adws/forge/parkComment.ts` defines `ParkReason.WorktreeLost` with the heading "The Plan Was Lost with the Worktree" (#1078).
* `git ls-files specs` lists one file: the plan of #1078, committed by the pipeline host, which was still running main at the time. See More Information.

## More Information

* PRD: [specs-worktree-only-and-docs-relocation](../prd/specs-worktree-only-and-docs-relocation.md). Issues #1076 (move and sweep), #1077 (plan commit retired, runtime ignore), #1078 (park on lost plan), #1079 (prompts), #1080 (a pre-existing resume bug found during the grill: the comment parser recognised only the pre-2026 plan file name).
* Supersedes [ADR-0056](0056-planner-commits-only-the-plan.md) in part: the plan phase makes no commit at all, so the question of what that commit may carry no longer arises. The guard ADR-0056 asked for was never built and is now moot.
* Deployment lag, not divergence: as of 2026-10-21 main had not been released since 2026-10-19, so the host still commits plans with the old code. Every run until the release leaves one tracked plan file on dev, and the host's daily docs-index sweep inspects dev with code that hardcodes the old record directory. The PRD's sequencing called for the release the same day #1076 merged (2026-10-20 18:57Z).
* Facts established during the grill: 838 tracked files, 53% of the `git ls-files` byte count; the conditional-docs index went from 70 entries on 2026-09-01 to 47 after #810 and 50 on 2026-10-19 with the gate green, which is why the `app_docs/` side needed no further work.
