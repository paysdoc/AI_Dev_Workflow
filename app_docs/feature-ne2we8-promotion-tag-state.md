# Promotion Tag State

## Overview

This module is the single source of truth for the on-file promotion markers `@promotion-suggested-<date>` and `@promotion-declined` that appear on `features/per-issue/feature-N.feature` files. It is a small, pure, dependency-free string module (no `fs`/git/gh imports) modelling the terminal state machine `none -> suggested -> declined`, consumed by the 14-day per-issue scenario sweep (see `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`) to decide whether a stale scenario should be exempted from deletion.

## Responsibilities

- `parsePromotionTagState(content)`: reads a feature file's full text and returns its promotion state (`'none' | 'suggested' | 'declined'`), considering only Gherkin *tag lines* — a line where every whitespace-separated token starts with `@` — anywhere in the file (feature-level or scenario-level, placement-agnostic).
- `serializePromotionTagState(content, target, opts)`: applies a target state to the feature-level tag line (the tag line directly above `Feature:`, created if absent, matching its indentation) idempotently — adds/replaces/strips the marker while preserving every non-marker token (e.g. `@adw-N`) and all other file bytes.
- `isPromotionExempt(state)`: the pure exemption predicate — `true` only for `'suggested'`; `'declined'` and `'none'` are not exempt.

## Contracts & Invariants

- No I/O: every function takes a string and returns a new string/value; nothing is mutated, nothing touches disk, git, or gh.
- `declined` is terminal and wins over a lingering `suggested` marker if both are present on the same file (a malformed/partially-written file resumes the normal TTL rather than being exempt forever) — matches "rejecting a promotion is durable."
- Only tag *lines* are matched (exact-token equality against `@promotion-declined` / the dated regex `^@promotion-suggested-\d{4}-\d{2}-\d{2}$`), never prose — a Feature description or step that merely mentions a marker as literal text is not parsed as a tag.
- `serializePromotionTagState` is idempotent: re-applying the same target (same `opts.date` for `'suggested'`) yields byte-identical output, and round-trips (`parsePromotionTagState(serializePromotionTagState(c, s, opts)) === s`).
- `target: 'suggested'` requires `opts.date` (`YYYY-MM-DD`) and throws if omitted.
- If the file has no `Feature:` line at all, `serializePromotionTagState` returns the content unchanged (no-op).

## Configuration

None — pure string logic, no environment variables or config files.

## Gotchas

- This module intentionally does not import from `adws/promotion/promotionTagWriter.ts` (the legacy promotion module slated for deletion in a later PRD slice) even though it adapts the same marker regex/token patterns — it must carry zero dependency on that doomed module.
- Only `parsePromotionTagState` and `isPromotionExempt` are wired into production today (`adws/triggers/perIssueScenarioSweep.ts`); `serializePromotionTagState` has no production caller yet — it is built and unit-tested ahead of a later automated promotion-sweep slice that will write the marker.
- An undated `@promotion-suggested` (missing `-YYYY-MM-DD`) does not match the dated regex and parses as `'none'` (not exempt) — only a properly dated suggestion protects a file from the sweep.
