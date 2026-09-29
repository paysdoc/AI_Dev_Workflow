---
status: superseded
date: 2026-03-01
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-44-adw-remove-classify-adw-jfxgze-sdlc_planner-remove-classify-adw-command.md
  - kind: contemporaneous
    source: specs/issue-44-plan.md
  - kind: contemporaneous
    source: "issue #44; commits bfe63e7b, dc6e90bf (PR #45)"
supersedes: []
superseded-by: ["0041"]
---

# Extract ADW commands and adwId from issue text by regex, not by an LLM

## Context and Problem Statement

An issue could name the ADW workflow to run by carrying a command such as `/adw_plan` or `/adw_build` in its text, optionally with an `adwId`. `classifyWithAdwCommand` in `adws/core/issueClassifier.ts` already ran a deterministic regex (`extractAdwCommandFromText`) and then fell back to an LLM slash command, `/classify_adw`, which extracted the same command and the `adwId`. The question was whether the LLM step earned its cost.

## Decision Drivers

* Issue #44: "The /classify_adw command does not add any useful LLM reasoning. The command can be rplaced by a simple regex" and "adwId should also be findable using code".
* The spec called command extraction "a pattern-matching task that regex handles better, faster, and cheaper".

## Considered Options

None recorded. The spec describes only the removal of the LLM step.

## Decision Outcome

The `/classify_adw` command was deleted and ADW command classification became regex-only:

* `.claude/commands/classify_adw.md`, `parseAdwClassificationOutput` and the `AdwClassificationResult` type were removed, along with the `/classify_adw` entries in the model maps.
* `classifyWithAdwCommand` became synchronous. It matched the command with `extractAdwCommandFromText` and the `adwId` with a new `extractAdwIdFromText`, which accepted label-prefixed forms (`adwId: x`, `ADW ID: x`, `adw_id: x`) and backtick-wrapped IDs.
* The PR review on the same day widened the backtick pattern to accept both `adw-` and `adw_` prefixes (specs/issue-44-plan.md).

The decision covered the ADW-command step only. An issue whose text held no ADW command still went to the LLM heuristic `/classify_issue`; the two-step path (regex first, LLM second) is described in specs/issue-546-adw-d6rky0-delete-extractadwcom-sdlc_planner-remove-regex-classification-path.md.

### Consequences

* Good, because command and `adwId` extraction cost no LLM call and gave the same answer for the same text.
* Good, because `classifyWithAdwCommand` no longer needed an output file or an agent run.
* Bad, because the trigger was a substring match on free-form issue text.

### Confirmation

This decision is no longer in force. Checked on 2026-09-29:

* `grep -rn "extractAdwCommandFromText\|classifyWithAdwCommand\|extractAdwIdFromText\|adwCommandToIssueTypeMap" adws README.md` returns nothing.
* `.claude/commands/` contains `classify_issue.md` and no `classify_adw.md`.
* The regex path was deleted by commit abc0b120 (2026-06-08, #546).

## More Information

* Replaced by [ADR-0041](0041-label-based-classification.md), which gives the reason.
* Two follow-up commits on 2026-03-01 adjusted the regex path while it was in force: 92d1048e (strip fenced code blocks before command matching) and dc6e90bf (underscore prefix).
* `extractAdwIdFromComment` in `adws/core/workflowCommentParsing.ts` is a separate parser for ADW-posted comments. It was not part of this decision and is still in use.
