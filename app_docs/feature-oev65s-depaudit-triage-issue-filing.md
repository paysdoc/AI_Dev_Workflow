# /depaudit-triage — Issue Filing Paths (Major-Bump + Upstream-Issue)

**ADW ID:** oev65s
**Date:** 2026-04-17
**Specification:** specs/issue-438-adw-o28sw7-depaudit-triage-skil-sdlc_planner-depaudit-triage-issue-filing.md

## Overview

Completes the `/depaudit-triage` skill's action menu by wiring two previously stubbed paths: the **major-bump path** (Action 1) files a tracked issue on the current repo when a direct upgrade requires a major version bump, and the **upstream-issue path** (Action 3) files an issue on the dependency's own repository for transitive-fix cases. Both paths are idempotent — re-invoking triage on a finding that already has a non-empty `upstreamIssue` in its accept entry is a no-op (no duplicate issue filed, no accept entry overwritten).

## What Was Built

- **Action 1 — Major-bump issue filing**: When `semver.major(to) > semver.major(from)`, the skill does not apply the upgrade; instead it calls `gh issue create` on the current repo with the stable title format `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`, embeds `/adw_sdlc` in the body so ADW picks up the issue for the full upgrade SDLC, and writes a short-lived accept entry (default 30 days, user-adjustable up to the 90-day cap) with `upstreamIssue` pointing to the new issue.
- **Action 3 — Upstream-issue filing**: Files an issue on `<dep-owner>/<dep-repo>` via `gh issue create --repo`, captures the returned URL, and writes an accept entry referencing it. Auto-files unconditionally — no ADW-registration check.
- **Belt-and-braces idempotency**: Both new action bodies re-check the idempotency guard (non-empty `upstreamIssue` → display `in flight — issue #N` and advance) in addition to the top-of-Step-3 guard already established in issue #436.
- **Lint safety**: Every accept entry written by Actions 1, 2, and 3 is schema-valid — `(package, version, finding-id)` identity, `reason ≥20 chars`, `expires ≤ today + 90d` — so `depaudit lint` passes on the very next scan.
- **BDD content-assertion scenarios** (`@adw-438`): 20 scenarios verifying every required phrase in SKILL.md, following the `@adw-436`/`@adw-437` content-assertion pattern.

## Technical Implementation

### Files Modified

- `.claude/skills/depaudit-triage/SKILL.md`: Replaced the Action 1 major-refuse stub with the full major-bump issue filing flow; replaced the Action 3 "not yet wired" stub with the full upstream-issue filing flow; updated both menu bullets to reflect the wired behavior; appended three Notes bullets (major-bump auto-filing, upstream-issue auto-filing, lint safety).
- `features/depaudit_triage_issue_filing.feature`: New BDD feature file with 20 `@adw-438 @regression` content-assertion scenarios covering major-bump detection, title format, `/adw_sdlc` embedding, accept entry fields (upstreamIssue, reason, expires), idempotency, upstream-issue `gh` invocation, URL capture, unconditional auto-filing, and menu preservation.

### Key Changes

- **Action 1 major-bump flow** (SKILL.md lines 98–118): The new body contains the stable title literal, the `/adw_sdlc` body embedding, expiry prompt with default/cap/adjust vocabulary, `gh issue create` (no `--repo` flag → current repo), issue URL capture, schema-valid accept-entry write, `gh`-failure handling (do not write entry on error), and advance without re-scan.
- **Action 3 upstream-issue flow** (SKILL.md lines 163–179): Resolves `<dep-owner>/<dep-repo>` from finding metadata or user prompt; drafts title (`depaudit: <package>@<version> — <finding-id>`) and body (no `/adw_sdlc`); runs `gh issue create --repo <dep-owner>/<dep-repo>`; captures returned URL; writes schema-valid accept entry; handles `gh` failure and missing repo coordinates.
- **OSV/TOML schema quirk**: `osv-scanner.toml` `[[IgnoredVulns]]` has no native `upstreamIssue` field. For OSV findings, the issue URL is embedded in `reason` as `pending major-bump issue #N — <url>` so the idempotency guard can recognize the in-flight state.
- **Menu bullets updated**: Action 1 now reads "autonomous minor/patch bump; for major bumps, files a tracked issue on the current repo and writes a short-lived accept entry"; Action 3 now reads "file an issue on the dependency's own repo and record the returned URL in the accept entry."
- **All `@adw-436` and `@adw-437` asserted phrases preserved**: `major`, `gh issue create`, `/adw_sdlc`, `semver`, `upgrade parent`, `accept+file-upstream-issue`, and all other prior assertions continue to pass without editing the prior feature files.

## How to Use

1. Run `depaudit scan` in the target repo to generate `.depaudit/findings.json`.
2. Invoke `/depaudit-triage` (optionally pass a custom path: `/depaudit-triage path/to/findings.json`).
3. The skill reads the snapshot, filters to `classification: "new"` findings, and skips any already-in-flight finding (non-empty `upstreamIssue`).
4. For each finding, choose an action:
   - **1 (upgrade parent)**: The skill classifies the bump as minor/patch or major.
     - Minor/patch → applies the upgrade autonomously (manifest edit + install).
     - Major → prompts for an expiry date (default 30 days; max 90 days), files a GitHub issue on the current repo with the stable title and `/adw_sdlc` body, writes the accept entry, and advances.
   - **2 (accept+document)**: Prompts for `reason` (≥20 chars) and `expires` (≤90 days); writes the accept entry.
   - **3 (accept+file-upstream-issue)**: Resolves the dep's repo coordinates, prompts for `reason` and `expires`, files on `<dep-owner>/<dep-repo>`, captures the returned URL, writes the accept entry, and advances.
   - **4 (skip)**: Advances without writing anything.
5. After all findings are processed, a completion summary is displayed (accepted / skipped / in-flight counts).

## Configuration

No additional configuration required beyond what was established in issues #436 and #437:
- `gh` CLI must be on `PATH` and authenticated.
- `.depaudit/findings.json` must exist (run `depaudit scan` first).
- `.adw/commands.md` `## Install Dependencies` is used by the minor/patch upgrade flow (Action 1).

## Testing

Run the content-assertion BDD suite:

```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-438"
```

Run regression suites for prior contracts:

```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-437"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-436"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Spot-check key phrases in SKILL.md:

```sh
grep -c "depaudit: major upgrade — <package> <from>" .claude/skills/depaudit-triage/SKILL.md  # ≥1
grep -c "/adw_sdlc" .claude/skills/depaudit-triage/SKILL.md                                   # ≥1
grep -c "gh issue create --repo" .claude/skills/depaudit-triage/SKILL.md                       # ≥1
grep -c "pending major-bump issue #" .claude/skills/depaudit-triage/SKILL.md                   # ≥1
grep -c "not yet wired" .claude/skills/depaudit-triage/SKILL.md                                # 0
```

## Notes

- **Markdown-only change**: `SKILL.md` is a Claude Code prompt, not compiled code. No new npm packages, no TypeScript changes required for this feature.
- **OSV `upstreamIssue` convention**: Since `osv-scanner.toml` has no native `upstreamIssue` field, the issue URL is embedded in `reason` as `pending major-bump issue #N — <url>`. The idempotency guard treats a `reason` containing a URL in this format as equivalent to a non-empty `upstreamIssue` for OSV findings.
- **`target: false`**: The skill is not deployed to target repos via `adw_init`. It remains a developer-facing tool in the ADW repo only.
- **Static snapshot invariant preserved**: Neither new action calls `depaudit scan` — the findings snapshot from Step 1 is never refreshed during a triage session.
- **Blocked issues**: This feature was blocked by issue #437 (minor/patch upgrade flow). The prior `@adw-437` phrase `refuse` and `future issue` were NOT asserted in the feature file — the wired major-bump flow naturally satisfies all actual `@adw-437` assertions.
