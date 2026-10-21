---
status: accepted
date: 2026-08-28
recorded: 2026-09-29
provenance:
  - kind: transcript
    source: "Claude Code session bf752843, 2026-08-28"
  - kind: contemporaneous
    source: "issue #810; specs/issue-810-*.md; PR #824"
supersedes: ["0044"]
superseded-by: []
---

# Docs index health is checked by a CI gate and a daily sweep

## Context and Problem Statement

[ADR-0044](0044-living-docs-per-module.md) kept `.adw/conditional_docs.md` small through convergence at write time and built no periodic check. Issue #810 records what followed. The migration merged on 2026-06-19 with 47 entries. Within 48 hours, feature branches cut before the migration brought the old index back: where the mass deletion collided with an appended entry, the `resolve_conflict` agent kept the branch's whole file. The index went to 195 and then 217 entries.

Nothing caught it. `checkLivingDocsIndex.ts` was a one-off acceptance script, wired into neither CI nor `package.json`. The post-write guards inspect only the entry being written. The index stayed broken for two months; by 2026-08-28, 58 % of its links were dead and planners read about 45K tokens of it. The plan agent for #797 hit the 30-minute watchdog at about 600K context tokens.

The owner's question in the session: "I thought that the doc cleanup would happen at regular intervals. Does the code for this not exist?"

## Decision Drivers

* Index health is a property of the whole index, not of a single write.
* A merge must not be able to land a broken index unnoticed.
* Judgement calls on the index go to a human. The June regression was itself an agent's judgement call.

## Considered Options

None recorded. The earlier choice of write-time convergence with no backstop is in ADR-0044.

## Decision Outcome

Repair the index by hand at once, then add a periodic sweep and a CI gate, filed as one issue (#810). The hand repair was applied on 2026-08-28. The gate and sweep merged on 2026-09-08 (PR #824).

* **One pure module.** `adws/core/docsIndexHealth.ts` classifies findings as repairs (dangling entry, dead `Owns:` glob) or violations (non-canonical serialisation, duplicate doc path, orphan doc, overlapping globs, entry count outside the band 25 to 60). The gate and the sweep both call it.
* **CI gate.** `bun run lint:docs-index` runs on every pull request and push. It walks the filesystem, so it needs no credentials. It fails on violations and dangling entries. Dead globs are warnings, so that a chore that renames a file is not blocked; a chore runs the document phase only when the diff judge escalates ([ADR-0027](0027-llm-diff-gate-for-chores.md)).
* **Sweep.** `adws/triggers/docsIndexSweep.ts` runs from the cron every `DOCS_INDEX_SWEEP_INTERVAL_CYCLES` cycles (default 4320, about daily), for the cron's own repo only. Repairs go through a dedicated worktree, the branch `chore/docs-index-sweep` and a PR merged at once. Violations are reconciled into exactly one open issue.
* **Report issue.** It carries `hitl` and `adw:none`, so the pipeline does not pick it up. A human delegates by replacing `adw:none` with `adw:chore`.
* **Count band.** Enforced by the sweep only for the ADW repo itself; it would raise false alarms on a newly initialised target repo.
* **Convergence pass.** 23 feature docs were folded into their module docs to bring the index from 70 to 47 entries.

### Consequences

* Good, because a dangling entry or dead glob is repaired within a day without an agent's judgement.
* Good, because a broken index shows as a failed check on the PR that introduces it.
* Bad, because the gate does not block a merge. The repository has no required status checks and ADW's merge path does not consult CI; the spec for #810 says so and leaves the ruleset change to the owner. See [ADR-0019](0019-dev-and-main-branches-with-runner-clone.md).
* Bad, because the band 25 to 60 is calibrated to ADW and must be revisited if the module count grows.
* Bad, because the cause of the regression, `resolve_conflict` resolving the index as text, is not fixed. The spec lists it as out of scope for #810.

### Confirmation

Checked on 2026-09-29:

* `bunx tsx adws/checkLivingDocsIndex.ts` reported 47 entries, 45 docs and passed all six checks.
* `.github/workflows/git-cli-guard.yml` has a `docs-index` job that runs `bun run lint:docs-index` on `pull_request` and `push`.
* `adws/triggers/trigger_cron.ts` calls `runDocsIndexSweepTick`.
* `adws/core/docsIndexReportBody.ts` returns the labels `hitl` and `adw:none` and the marker `Reconciles: docs-index-health`.
* `adws/triggers/docsIndexSweepDefaults.ts` applies the count band only when `gitContext.selfHost` is true.

Unit tests: `adws/core/__tests__/docsIndexHealth.test.ts`, `adws/triggers/__tests__/docsIndexSweep.test.ts`. Whether the sweep has run in production was not checked.

## More Information

* Supersedes [ADR-0044](0044-living-docs-per-module.md) in part: only the choice to have no periodic backstop. The per-module doc model and write-time convergence remain in force.
* The per-write guards in `adws/core/docsGuards.ts` are unchanged. They use a conservative prefix heuristic; the whole-index check compares owned files, to avoid false positives in a hard gate.
* The decision date is the day of the session and of issue #810. The implementation details above come from the spec dated 2026-09-08.
