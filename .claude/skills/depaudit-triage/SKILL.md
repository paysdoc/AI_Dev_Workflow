---
name: depaudit-triage
description: Interactive triage skill for dependency audit findings. Reads `.depaudit/findings.json` as a static snapshot, walks each "new" finding sequentially, and offers actions to accept+document or skip. Use after running `depaudit scan` to review and document risk acceptance decisions without manually editing YAML/TOML config files.
target: false
---

# /depaudit-triage

Triage dependency audit findings interactively. Work through each finding one at a time.

## Step 1: Read Findings

Read `.depaudit/findings.json` from the current working directory. If the file does not exist or is missing, stop immediately and tell the user:

> `.depaudit/findings.json` not found. Run `depaudit scan` first to generate findings.

**Static snapshot**: The findings file is treated as a static snapshot — read it once at the start of the session. Do NOT trigger a re-scan or run `depaudit scan` at any point during the triage. After triage, the user can re-run `depaudit scan` manually if needed.

## Step 2: Parse and Filter

Parse the JSON array. Filter to findings where `classification` is `"new"`.

If no new findings exist, report:

> No new findings to triage.

Then stop.

## Step 3: Walk Each Finding Sequentially

Work through all new findings one at a time in sequence.

**Before presenting a finding**, run the idempotency check: look in the relevant config file for an existing accept entry matching this finding's identity `(package, version, finding-id)` that already has a non-empty `upstreamIssue`. If found, display:

> Finding [finding-id] for [package]@[version] is in flight — issue #N

Auto-skip it and move to the next finding.

**For each remaining finding**, display a summary and present the menu:

```
Package:     <package>
Version:     <version>
Finding ID:  <finding-id>
Severity:    <severity>
Source:      <OSV | Socket>
Description: <description>

Choose an action:
  1. upgrade parent            — not yet wired (coming in a future issue)
  2. accept+document           — write an acceptance entry to the config file
  3. accept+file-upstream-issue — not yet wired (coming in a future issue)
  4. skip                      — move to next finding without changing anything
```

Wait for the user's choice (1–4).

## Step 4: Handle Each Action

### Action 1: upgrade parent

Display: "Not yet wired — coming in a future issue." Treat as skip and move to the next finding.

### Action 2: accept+document

**Prompt for `reason`:**

> Enter reason for accepting this finding (minimum 20 characters):

Validate: `reason` must be ≥20 characters. Re-prompt if too short.

**Prompt for `expires`:**

> Enter expiry date in ISO 8601 format (YYYY-MM-DD), maximum 90 days from today:

Validate: `expires` must be a valid ISO 8601 date that is not in the past and is ≤ today + 90 days. Re-prompt if invalid.

**Determine the target config file** based on `source`:

- If `source` is `"socket"` (supply-chain finding): write to `.depaudit.yml` under `supplyChainAccepts`
- If `source` is `"osv"` (CVE finding): write to `osv-scanner.toml` under `[[IgnoredVulns]]`

**Write the entry** using the correct schema:

For `.depaudit.yml` supply-chain entries:
```yaml
supplyChainAccepts:
  - package: <package>
    version: <version>
    alertType: <finding-id>
    reason: <reason>
    expires: <expires>
    upstreamIssue: ""
```

For `osv-scanner.toml` CVE entries:
```toml
[[IgnoredVulns]]
id = "<finding-id>"
ignoreUntil = "<expires>"
reason = "<reason>"
```

Use Read and Edit tools to modify the files. If `.depaudit.yml` or `osv-scanner.toml` do not exist yet, create them with minimal valid structure before writing the entry.

Respect identity `(package, version, finding-id)`: if an entry with the same identity already exists, update it rather than create a duplicate.

### Action 3: accept+file-upstream-issue

Display: "Not yet wired — coming in a future issue." Treat as skip and move to the next finding.

### Action 4: skip

Move to the next finding. Leave all state files untouched — do not write anything. The skip action moves to the next finding without writing anything to `.depaudit.yml`, `osv-scanner.toml`, or any other file.

## Step 5: Completion Summary

After all findings are processed, display:

> Triage complete.
> - Accepted: N
> - Skipped: N
> - In flight (auto-skipped): N

## Notes

- **Identity model**: Accept entries are keyed by the strict triple `(package, version, finding-id)`. A version bump invalidates any prior acceptance — the user must re-evaluate.
- **Idempotency**: Findings with a non-empty `upstreamIssue` in an existing accept entry are already in progress. Auto-skip them with the "in flight — issue #N" message.
- **File creation**: If `.depaudit.yml` does not exist, create it with `version: 1` and empty `supplyChainAccepts: []`. If `osv-scanner.toml` does not exist, create it with an empty `[[IgnoredVulns]]` section.
- **Static snapshot**: Do not re-scan or re-read `findings.json` after accepting or skipping a finding. The triage session works from the snapshot read in Step 1.
- **$ARGUMENTS**: If a custom path to findings.json is provided, use it instead of the default `.depaudit/findings.json`.
