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
  1. upgrade parent            — autonomous minor/patch bump; for major bumps, files a tracked issue on the current repo and writes a short-lived accept entry
  2. accept+document           — write an acceptance entry to the config file
  3. accept+file-upstream-issue — file an issue on the dependency's own repo and record the returned URL in the accept entry
  4. skip                      — move to next finding without changing anything
```

Wait for the user's choice (1–4).

## Step 4: Handle Each Action

### Action 1: upgrade parent

The `upgrade parent` action is wired for the minor and patch case. For the major case the skill does not apply the major bump directly — instead it files a tracked issue on the current repo.

**Step 1: Semver classification (minor/patch vs major)**

Parse the current parent version (`from`) and the target parent version (`to`) as semver `MAJOR.MINOR.PATCH`. Strip any ecosystem-specific prefix (e.g. `v` for Go modules, `^` / `~` / `>=` for npm ranges, PEP 440 prefixes for Python) before comparing.

- If `to.major > from.major`: this is a **major** bump — follow the major-bump issue filing flow below.
- Otherwise (`to.major === from.major`): this is a **minor** or **patch** bump — follow the autonomous minor/patch flow below.

**Step 2: Compute the smallest resolving target version**

Inspect the available resolving versions of the direct parent from the finding's metadata and pick the **smallest** upgrade target version that resolves the finding. This keeps the diff minimal and avoids pulling in unrelated changes.

**Step 3 (minor/patch): Autonomous minor/patch flow**

For a minor or patch bump the skill applies the change autonomously — there is no extra confirmation beyond the single cancel prompt described below. Steps:

1. Detect the ecosystem from the finding's manifest path. Supported manifests include `package.json` (npm / bun), `go.mod` (Go), `Cargo.toml` (Rust), `requirements.txt` / `pyproject.toml` (Python), `pom.xml` (Maven), `Gemfile` (Ruby), and `composer.json` (PHP).
2. Display a one-line summary in the form `<package> <from> → <to> (minor|patch)` along with the manifest path.
3. Read the manifest with the Read tool. Save the original manifest content in memory as `originalManifest` so it can be restored later.
4. Edit the manifest in place with the Edit tool to bump the parent's version specifier to `to`. For `package.json` the specifier lives under `dependencies` / `devDependencies`; for `go.mod` it is in the `require` block; for TOML/YAML manifests it is the version string.
5. Prompt the user once — **before the install command runs** — with: `Manifest edited. Proceed with install? (y/n)`. This gives the user an explicit chance to cancel a pending upgrade before the install command runs.
6. Handle the response:
   - **On `n` (cancel)**: revert the manifest edit by writing `originalManifest` back to the manifest file. Display `Upgrade cancelled — manifest reverted.` Move to the next finding without writing any accept entry.
   - **On `y` (proceed)**: resolve the install command (see below) and run it via the Bash tool.

**Resolving the install command**:

- If the current working directory's `.adw/commands.md` has an `## Install Dependencies` section, use that value as the source of truth.
- Otherwise fall back to the **ecosystem default** for the detected manifest: `bun install` or `npm install` for `package.json`, `go mod tidy` for `go.mod`, `cargo build` for `Cargo.toml`, `pip install -r requirements.txt` or `poetry install` for Python, `mvn dependency:resolve` for `pom.xml`, `bundle install` for `Gemfile`, `composer install` for `composer.json`.

**Handle install outcomes**:

- **Install success** (exit code 0): display `Upgraded <package> <from> → <to>. Moving to next finding.` Advance to the next finding. Do NOT run `depaudit scan` — the static snapshot is preserved. Do NOT write an accept entry — the finding is resolved in-tree and a later `depaudit scan` will prune any orphaned entry.
- **Install fails** (non-zero exit, install command not found, etc.): revert the manifest by writing `originalManifest` back to the manifest file so the workspace is left unchanged — **no partial bump** remains in the workspace. Display `Install failed — manifest reverted. No partial bump left in the workspace. Error: <stderr/stdout output>`. Move to the next finding without writing any accept entry.

**Step 3 (major): Major-bump issue filing flow**

When the classification is a **major** bump the skill **does not apply** the major version upgrade directly to the manifest. Instead it files a tracked issue on the current repo and writes a short-lived accept entry pointing to that issue.

1. **Re-check idempotency**: Re-check the idempotency guard for this finding's `(package, version, finding-id)` identity — if an existing accept entry already has a non-empty `upstreamIssue`, display `in flight — issue #N` and advance to the next finding without re-filing — no duplicate issue is created and no accept entry is written.
2. **Prompt for expiry**: Prompt for an expiry date (default 30 days from today, user-adjustable up to the 90-day cap):
   > Enter expiry date in ISO 8601 format (YYYY-MM-DD) [default: today + 30 days, max: today + 90 days]:
   Validate: must be a valid ISO 8601 date, not in the past, and ≤ today + 90 days. Store as `expires`. Re-prompt on invalid input.
3. **Draft the issue**: Draft the issue using the stable format:
   - **Title**: `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`
   - **Body**: Human-readable summary (package, from version, to-range, finding-id, severity, source), a pointer to the originating finding, and the literal `/adw_sdlc` command on its own line so ADW immediately picks up the issue and runs the upgrade SDLC.
4. **File the issue**: Run `gh issue create --title <title> --body <body>` against the **current repo** (no `--repo` flag — the default targets the current working directory's repo).
5. **Capture details**: Capture the returned issue number `#N` and URL from `gh`'s stdout.
6. **Write the accept entry**: Write (or update) an accept entry in the correct config file based on `source`:
   - `source: "socket"` → `.depaudit.yml` under `supplyChainAccepts`
   - `source: "osv"` → `osv-scanner.toml` under `[[IgnoredVulns]]`

   Set: `package`, `version`, `alertType`/`id` from the finding identity; `reason: "pending major-bump issue #N"`; `expires` to the chosen date; `upstreamIssue` to the captured URL. For OSV/TOML entries (no native `upstreamIssue` field), embed the URL in `reason` as `pending major-bump issue #N — <url>` so the idempotency guard recognises the in-flight state. Respect `(package, version, finding-id)` identity — update existing entry rather than duplicate. Every entry must be schema-valid so `depaudit lint` passes.
7. **Handle `gh` failure**: If `gh issue create` fails (non-zero exit) or `gh` is not on PATH, surface the stderr and do NOT write the accept entry — avoid orphaned entries referencing a non-existent issue. Move to the next finding.
8. **Advance**: Display `Major-bump issue filed: <url>. Accept entry written with <N>-day expiry.` Advance to the next finding. Do NOT run `depaudit scan` — the static snapshot is preserved.

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

File an issue on the dependency's own upstream repository for transitive-fix cases and record the returned URL in the accept entry.

1. **Re-check idempotency**: Re-check the idempotency guard — if an accept entry with a non-empty `upstreamIssue` already exists for this finding's identity, display `in flight — issue #N` and advance to the next finding without re-filing.
2. **Resolve repo coordinates**: Resolve `<dep-owner>/<dep-repo>` from the finding's `repositoryUrl` or `upstreamRepo` field (if present in `findings.json`). If absent, prompt the user for `<owner>/<repo>`. If the user provides no value, treat as skip — do NOT call `gh`, do NOT write any entry.
3. **Prompt for reason and expiry**:
   - Prompt for `reason` (≥20 chars), validated the same way as `accept+document`.
   - Prompt for `expires` (default 30 days, ≤ today + 90 days), validated the same way as `accept+document`.
4. **Draft the issue**: The skill drafts a concise title and body for the upstream issue:
   - **title**: `depaudit: <package>@<version> — <finding-id>`
   - **body**: Human-readable finding description, severity, source, the package and version affected on the downstream side, a pointer back to the originating finding, and a short request to the dependency's maintainers to address the issue. The body does NOT include `/adw_sdlc` — ADW SDLC integration is only for the current-repo major-bump path.
5. **File the issue**: Run `gh issue create --repo <dep-owner>/<dep-repo> --title <title> --body <body>`. Auto-files unconditionally — do not check whether the upstream is ADW-registered. Per PRD: auto-filing is unconditional of whether the upstream is ADW-registered.
6. **Capture the returned URL**: Capture the returned URL from `gh`'s stdout.
7. **Write the accept entry**: Write (or update) an entry in the correct file (`.depaudit.yml` under `supplyChainAccepts`, or `osv-scanner.toml` under `[[IgnoredVulns]]`) with `upstreamIssue` set to the returned URL, `reason` set to the user-supplied reason, and `expires` set to the user-supplied or default expiry. Respect `(package, version, finding-id)` identity — update existing entry rather than duplicate. The accept entry must be schema-valid so `depaudit lint` passes.
8. **Handle `gh` failure**: If `gh issue create` fails (non-zero exit) or `gh` is not on PATH, surface the error and do NOT write the accept entry. Move to the next finding.
9. **Advance**: Display `Upstream issue filed: <url>. Accept entry written.` Advance to the next finding.

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
- **Upgrade policy**: minor and patch parent bumps are applied autonomously by Action 1 (`upgrade parent`); major bumps trigger the issue-filing flow — the skill does not apply them directly but files a tracked issue on the current repo and writes a short-lived accept entry.
- **Major-bump auto-filing**: Action 1 (`upgrade parent`) auto-files a tracked issue on the current repo when only a major bump resolves the finding; it embeds `/adw_sdlc` in the body so ADW runs the upgrade SDLC, and writes a short-lived accept entry (default 30 days, user-adjustable up to the 90-day cap) pointing to the filed issue.
- **Upstream-issue auto-filing**: Action 3 (`accept+file-upstream-issue`) runs `gh issue create --repo <dep-owner>/<dep-repo>` unconditionally (no ADW-registration check), captures the returned URL, and writes a schema-valid accept entry with `upstreamIssue` set.
- **Lint safety**: Every entry written by the skill (Actions 1, 2, 3) is in canonical schema form — `(package, version, finding-id)` identity, `reason ≥20 chars`, `expires ≤ today + 90d` — so `depaudit lint` passes on the very next scan.
- **Revert safety**: Action 1 prompts before the install command runs so the user can cancel a pending upgrade; on cancel the skill reverts the manifest edit. If the install fails the skill also reverts the manifest to its original contents so the workspace is left unchanged (no partial bump).
- **$ARGUMENTS**: If a custom path to findings.json is provided, use it instead of the default `.depaudit/findings.json`.
