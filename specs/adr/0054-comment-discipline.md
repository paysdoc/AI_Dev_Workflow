---
status: accepted
date: 2026-09-24
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/comment-debloat.md
  - kind: contemporaneous
    source: "specs/issue-853-*.md; issue #853"
  - kind: transcript
    source: "Claude Code session 44ada946, 2026-09-24"
supersedes: []
superseded-by: []
---

# Comments say only what the code cannot

## Context and Problem Statement

ADW's code is written almost entirely by its own agents, and they comment heavily. The PRD measured about 8,800 comment lines in 61,700 lines under the workflow source tree, and per-issue feature files that were one fifth comment. Most of it restated the code: banner lines, JSDoc repeating a name, narration of the next statement, issue-number tags, and essays inside `.feature` files. Every agent that reads a file pays for those lines in context, and the comments that matter are buried among them.

The PRD traces the cause to two lines in `.adw/coding_guidelines.md` that told agents to comment and JSDoc "non-obvious logic", which agents over-applied.

## Decision Drivers

* Agents pay for every comment line they read.
* Deleting comments without changing the instruction is a symptom fix; the PRD expected the volume to return "within weeks".
* A sweep of comments must be provably free of code changes.
* The owner did not want a queue of sweep PRs waiting on approval.

## Considered Options

* Delete the existing comments and leave the guidelines as they were.
* Change the guidelines first, then sweep in batches verified by a comment-only guard.
* Add a permanent CI lint for banners and issue tags. Rejected; to be revisited only if regrowth is observed.
* Human review of each trim, by `hitl`. Rejected; git history is the recovery path.

## Decision Outcome

Chosen option: "Change the guidelines first, then sweep in batches verified by a comment-only guard", because the guideline is what produces the comments and the guard makes the sweep checkable by machine.

* **Rule.** `.adw/coding_guidelines.md` has one Comments entry: comment only invariants, ordering constraints and the reason for a non-obvious choice. No restating the next line, no section banners, no issue numbers (git blame carries history), no JSDoc on a name that already says what it is.
* **Feature files.** They carry no commentary, with at most one short line under `Feature:`. The owner's reason: "the feature files should be self explanatory".
* **Guard.** `adws/checkCommentOnly.ts` proves that listed files differ from a base ref only in comments. For TypeScript it compares token streams without trivia; for Gherkin it compares non-blank lines that do not start with `#`. Its core is pure.
* **Order.** The guideline, the scenario-writer rule and the guard shipped together in #853. Sixteen sweep batches were blocked on it, each capped at about forty files or a thousand comment lines, each with the guard passing as its acceptance scenario.
* **What the sweep kept.** Rationale and invariant comments, shebangs, lint directives, and in orchestrator headers the usage line and the list of environment variables.
* **Merge policy.** No `hitl`; batches merged once their scenarios passed.
* **No permanent gate.** The guideline is the only control against regrowth.

### Consequences

* Good, because files are shorter for agents and humans, and the surviving comments are the ones that carry reasons.
* Good, because a comment sweep can be verified without reading the diff.
* Bad, because the trimming of mixed comments was unsupervised; a rationale removed by mistake is recoverable only from git history.
* Bad, because nothing mechanical prevents regrowth.
* Bad, because the guard treats a shebang as trivia, so removing one would pass; keeping shebangs is a rule for the sweeping agent (spec for #853).

### Confirmation

Checked on 2026-09-29:

* `.adw/coding_guidelines.md` line 62 holds the Comments entry with the PRD's wording.
* `adws/checkCommentOnly.ts` exists, and `package.json` defines `lint:comment-only`. No workflow under `.github/workflows/` runs it, as decided.
* Issue #853 and the sweep issues (numbered between #854 and #884) are closed, all on 2026-09-24.
* A rough count over the 422 tracked TypeScript files under `adws/` (`grep -E '^\s*(//|/\*|\*)'`) found 4,428 comment lines in 60,939 lines and no banner lines. Feature files hold 28 lines starting with `#` in 4,007 lines. The method and the file set differ from the PRD's, so the figures are indicative only.
* `.claude/commands/scenario_writer.md` does not contain the feature-file rule; see the first unresolved item below.

The guard was not run while writing this ADR.

## More Information

* Unresolved: the scenario-writer rule is not in force. Commit bebda8dd (2026-09-24 10:38) added the rule, beginning "Feature files carry no commentary.", to `.claude/commands/scenario_writer.md`. Commit c3606f9e, a `plan-orchestrator` commit made 19 minutes later that also added the plan for sweep batch 16/16, removed it. `git show` finds the line on none of `origin/dev`, `origin/main` and `HEAD`. No source says the removal was intended.
* Unresolved: propagation to target repos. The PRD excludes them: the guideline shipped to target repos "is unchanged by this PRD; propagation is a separate decision". In the session the owner said "I want the new comment to propagate to the new repos too". What shipped matches the PRD: the Comments entry exists only in ADW's own `.adw/coding_guidelines.md`; `.claude/commands/adw_init.md` and `templates/` do not mention it. Which of the two statements is the decision is not settled by the sources.
* Markdown files and the `resolve_conflict` prompt are out of scope in the PRD.
