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
  1. upgrade parent            — autonomous minor/patch bump of the direct parent (major bumps refused in this slice)
  2. accept+document           — write an acceptance entry to the config file
  3. accept+file-upstream-issue — not yet wired (coming in a future issue)
  4. skip                      — move to next finding without changing anything
```

Wait for the user's choice (1–4).

## Step 4: Handle Each Action

### Action 1: upgrade parent

The `upgrade parent` action is wired for the minor and patch case. For the major case the skill refuses to apply the bump directly and points the user at the future issue that will handle it.

**Step 1: Semver classification (minor/patch vs major)**

Parse the current parent version (`from`) and the target parent version (`to`) as semver `MAJOR.MINOR.PATCH`. Strip any ecosystem-specific prefix (e.g. `v` for Go modules, `^` / `~` / `>=` for npm ranges, PEP 440 prefixes for Python) before comparing.

- If `to.major > from.major`: this is a **major** bump — follow the major refuse flow below.
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

**Step 3 (major): Major refuse flow**

When the classification is a **major** bump the skill **refuses** to apply it directly. Display:

> Major bump required: `<package> <from> → <to>`. The skill refuses to apply major bumps in this slice — the autonomous major-bump action lands in a future issue (it will file a tracked upstream issue and write a short-lived accept entry). For now, choose `accept+document` to record the risk, or `skip` to postpone.

Treat the finding as skipped: no manifest edit, no install, no accept entry. Move to the next finding.

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
- **Upgrade policy**: minor and patch parent bumps are applied autonomously by Action 1 (`upgrade parent`); major bumps are refused in this slice and will be handled by a future issue that files a tracked upstream issue and writes a short-lived accept entry.
- **Revert safety**: Action 1 prompts before the install command runs so the user can cancel a pending upgrade; on cancel the skill reverts the manifest edit. If the install fails the skill also reverts the manifest to its original contents so the workspace is left unchanged (no partial bump).
- **$ARGUMENTS**: If a custom path to findings.json is provided, use it instead of the default `.depaudit/findings.json`.
