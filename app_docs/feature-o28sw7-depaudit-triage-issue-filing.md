# depaudit-triage — Issue Filing Paths (Major-Bump + Upstream-Issue)

**ADW ID:** o28sw7
**Date:** 2026-04-17
**Specification:** specs/issue-438-adw-o28sw7-depaudit-triage-skil-sdlc_planner-depaudit-triage-issue-filing.md

## Overview

Completes the `/depaudit-triage` action menu by wiring the two previously-stubbed filing paths: when `upgrade parent` detects a major version bump, the skill now files a tracked issue on the current repo (with `/adw_sdlc` embedded) and writes a short-lived accept entry; a separate `accept+file-upstream-issue` action files on the dependency's own repo and records the returned URL. Both paths are idempotent and every file produced passes `depaudit lint`.

## What Was Built

- **Action 1 major-bump filing flow** — replaces the prior "refuse" stub; files `gh issue create` on the current repo with stable title format `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`, embeds `/adw_sdlc` in the body, and writes a schema-valid accept entry (default 30-day expiry, user-adjustable up to 90 days)
- **Action 3 upstream-issue filing flow** — replaces the "not yet wired" stub; runs `gh issue create --repo <dep-owner>/<dep-repo>` unconditionally (no ADW-registration check), captures the returned URL, and writes an accept entry with `upstreamIssue` set
- **Belt-and-braces idempotency re-checks** — both Action 1 and Action 3 re-check the `upstreamIssue` guard inside the action body (in addition to the top-level Step 3 guard), preventing duplicate filings mid-session
- **OSV/TOML quirk handling** — for `osv-scanner.toml` entries (no native `upstreamIssue` field), the URL is embedded in `reason` as `pending major-bump issue #N — <url>` so the idempotency guard recognises in-flight state
- **`gh` failure handling** — both paths surface stderr and do NOT write an accept entry on `gh` failure, avoiding orphaned entries referencing non-existent issues
- **BDD feature file** — `features/depaudit_triage_issue_filing.feature` with `@adw-438 @regression` content-assertion scenarios covering every new behavior

## Technical Implementation

### Files Modified

- `.claude/skills/depaudit-triage/SKILL.md`: replaced Action 1 major-refuse stub with full major-bump filing flow; replaced Action 3 "not yet wired" stub with upstream-issue filing flow; updated menu bullet descriptions; added Notes bullets for both paths and lint-safety invariant
- `features/depaudit_triage_issue_filing.feature`: new `@adw-438` BDD feature file with 20 content-assertion scenarios

### Key Changes

- **Action 1 (major-bump path)**: `gh issue create` targets the current repo (no `--repo` flag); stable title format includes `<package>`, `<from>`, `<to-range>`, and `resolves <finding-id>`; body includes `/adw_sdlc` so ADW immediately picks up the upgrade SDLC; accept entry uses `reason: "pending major-bump issue #N"` and `upstreamIssue` set to the captured URL
- **Action 3 (upstream-issue path)**: `gh issue create --repo <dep-owner>/<dep-repo>` auto-files unconditionally; repo coordinates resolved from `repositoryUrl`/`upstreamRepo` in findings, with user prompt fallback; body does NOT include `/adw_sdlc` (current-repo major-bump path only)
- **Idempotency**: both new actions contain a belt-and-braces re-check of the `upstreamIssue` accept-entry guard; re-invoking on a finding already in-flight yields `in flight — issue #N` with no duplicate filing
- **Schema safety**: every entry written by Actions 1, 2, and 3 is in canonical form — `(package, version, finding-id)` identity, `reason ≥20 chars`, `expires ≤ today + 90d` — so `depaudit lint` passes on the very next scan
- **Static snapshot preserved**: neither new action calls `depaudit scan` at any point; findings.json is read once at session start

## How to Use

1. Run `depaudit scan` in the target repo to generate `.depaudit/findings.json`
2. Invoke `/depaudit-triage` from Claude Code
3. Walk each finding sequentially; for a **major-bump** finding, choose action `1`:
   - Confirm or adjust the expiry (default 30 days, max 90 days)
   - The skill files the issue on the current repo and writes the accept entry automatically
4. For a **transitive-fix** finding where you want to notify the upstream maintainer, choose action `3`:
   - Confirm repo coordinates (auto-resolved from `repositoryUrl`/`upstreamRepo`, or prompted)
   - Enter `reason` (≥20 chars) and optional custom expiry
   - The skill files on the dependency's own repo and writes the accept entry
5. Both actions display a confirmation line and advance to the next finding automatically

## Configuration

- **`gh` CLI**: must be on PATH and authenticated; both filing paths shell out to `gh issue create`
- **Source routing**:
  - `source: "socket"` findings → accept entry written to `.depaudit.yml` `supplyChainAccepts`
  - `source: "osv"` findings → accept entry written to `osv-scanner.toml` `[[IgnoredVulns]]`; issue URL embedded in `reason` field (no native `upstreamIssue` in TOML schema)
- **Expiry cap**: maximum 90 days from today; default 30 days; user input validated (ISO 8601, not in the past, within cap)
- **`target: false`**: skill stays non-propagating — `adw_init` does not deploy it to target repos

## Testing

Run the BDD content-assertion suite:

```bash
# New @adw-438 scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-438"

# Regression: prior skill contract
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-437"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-436"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Manual spot-checks:
```bash
grep -c "depaudit: major upgrade — <package> <from>" .claude/skills/depaudit-triage/SKILL.md  # ≥1
grep -c "/adw_sdlc" .claude/skills/depaudit-triage/SKILL.md                                   # ≥1
grep -c "gh issue create --repo" .claude/skills/depaudit-triage/SKILL.md                      # ≥1
grep -c "pending major-bump issue #" .claude/skills/depaudit-triage/SKILL.md                  # ≥1
grep -c "not yet wired" .claude/skills/depaudit-triage/SKILL.md                               # 0
```

## Notes

- This is a **markdown-only change** to `SKILL.md` — no TypeScript, no new dependencies, no `bun add` required
- The prior `@adw-437` regression assertions (`major`, `gh issue create`, `/adw_sdlc`) are naturally satisfied by the wired major-bump flow; the words `refuse` and `future issue` were NOT asserted by `@adw-437` and do not need to be preserved
- OSV-scanner TOML schema does not carry a native `upstreamIssue` field; the idempotency guard recognises a URL embedded in `reason` (format: `pending major-bump issue #N — <url>`) as an in-flight indicator
- Upstream-issue path (Action 3) does NOT embed `/adw_sdlc` — that integration is current-repo-only (per PRD §Claude Code skill, to avoid loops on registered upstreams)
- All three accept-writing actions (1, 2, 3) respect `(package, version, finding-id)` identity — update existing entry rather than duplicate
