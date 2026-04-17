# depaudit-triage Skill

**ADW ID:** 1w5uz8-depaudit-triage-skil
**Date:** 2026-04-17
**Specification:** specs/issue-436-adw-1w5uz8-depaudit-triage-skil-sdlc_planner-depaudit-triage-skill.md

## Overview

Adds the `/depaudit-triage` Claude Code skill — an interactive, sequential triage workflow for dependency audit findings. The skill reads `.depaudit/findings.json` as a static snapshot, walks each "new" finding one at a time, and allows the user to accept+document (writing a schema-valid entry to `.depaudit.yml` or `osv-scanner.toml`) or skip each finding without manually editing config files.

## What Was Built

- `.claude/skills/depaudit-triage/SKILL.md` — the new skill file with `target: false` frontmatter
- BDD feature file (`features/depaudit_triage_skill.feature`) covering all acceptance criteria and edge cases
- Step definitions (`features/step_definitions/depauditTriageSkillSteps.ts`) for the BDD scenarios
- Model routing adjustment: several slash commands downgraded from `max` to `xhigh` reasoning effort

## Technical Implementation

### Files Modified

- `.claude/skills/depaudit-triage/SKILL.md`: New file — full triage workflow as a Claude Code skill prompt with `target: false` frontmatter
- `features/depaudit_triage_skill.feature`: New BDD scenarios covering happy path, skip, idempotency guard, validation, missing-file error, and file-creation edge cases
- `features/step_definitions/depauditTriageSkillSteps.ts`: New step definitions wiring the BDD scenarios to test infrastructure
- `adws/core/modelRouting.ts`: Effort map adjustments — `chore`, `patch`, `review`, `resolve_failed_test`, `resolve_failed_scenario`, `resolve_plan_scenarios`, `align_plan_scenarios` downgraded from `max` to `xhigh`
- `README.md`: Minor documentation update

### Key Changes

- **Skill structure**: The skill follows the `target: false` convention — it stays in ADW and is not copied to target repos during `adw_init`. It reads findings once (static snapshot) and never triggers a re-scan.
- **Two wired actions**: Only `accept+document` and `skip` are implemented in this slice. `upgrade parent` and `accept+file-upstream-issue` display "not yet wired — coming in a future issue" and behave as skip.
- **Schema-aware writes**: Supply-chain findings (`source: "socket"`) write to `.depaudit.yml` under `supplyChainAccepts`; CVE findings (`source: "osv"`) write to `osv-scanner.toml` under `[[IgnoredVulns]]`. Files are created with minimal valid structure if absent.
- **Idempotency guard**: Before presenting a finding, the skill checks whether an accept entry with the same `(package, version, finding-id)` identity and a non-empty `upstreamIssue` already exists; if so, it auto-skips with an "in flight — issue #N" message.
- **Input validation**: `reason` must be ≥20 characters; `expires` must be a valid ISO 8601 date not in the past and ≤ today + 90 days. Both re-prompt on invalid input.

## How to Use

1. Run `depaudit scan` in the target repo to generate `.depaudit/findings.json`.
2. Open Claude Code in the target repo.
3. Invoke the skill: `/depaudit-triage` (or `/depaudit-triage path/to/custom-findings.json` to use a non-default path).
4. The skill reads the findings snapshot and filters to findings with `classification: "new"`.
5. For each finding, review the summary and choose an action:
   - **2. accept+document**: Enter a reason (≥20 chars) and expiry date (≤90 days from today). The skill writes the entry to the correct config file.
   - **4. skip**: Move to the next finding without writing anything.
6. After all findings are processed, a summary shows accepted / skipped / in-flight counts.

## Configuration

- **No environment variables required** for the skill itself.
- The skill uses `$ARGUMENTS` to accept an optional custom path to `findings.json`; defaults to `.depaudit/findings.json`.
- `target: false` in the SKILL.md frontmatter ensures the skill is not propagated to target repos by `adw_init`.

## Testing

The BDD scenarios in `features/depaudit_triage_skill.feature` cover:
- Happy path: sequential walk with `accept+document` writing correct entries for supply-chain and CVE findings
- `skip` action leaves files untouched
- Idempotency: findings with existing `upstreamIssue` are auto-skipped
- Missing `findings.json` — clear error with actionable message
- Zero new findings — early exit with "No new findings to triage"
- Validation: short reason and out-of-range expiry trigger re-prompts
- File creation: skill creates `.depaudit.yml` / `osv-scanner.toml` if absent
- Deduplication: updating existing `(package, version, finding-id)` entry rather than duplicating it
- Stubbed actions: `upgrade parent` and `accept+file-upstream-issue` behave as skip

## Notes

- This feature is blocked by paysdoc/depaudit#8 (the depaudit CLI that produces `findings.json`). The skill can be invoked now if a `findings.json` is produced by any means, but end-to-end integration requires the depaudit CLI to be available.
- `upgrade parent` and `accept+file-upstream-issue` are deliberately stubbed — they will be wired in subsequent ADW issues.
- The identity model `(package, version, finding-id)` means a package version bump invalidates prior acceptance; the user must re-evaluate.
- The model routing change (several commands `max` → `xhigh`) is unrelated to the skill itself but was included in this branch to align effort levels with actual model capabilities.
