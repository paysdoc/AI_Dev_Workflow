# Chore: Fix the webhook payload URL documented in `adws/README.md`

## Metadata
issueNumber: `778`
adwId: `mh3mbt-chore-readme-documen`
issueJson: `{"number":778,"title":"chore: README documents wrong webhook payload URL","body":"# chore: README documents wrong webhook payload URL\n\n`adws/README.md` (webhook trigger section) documents the GitHub webhook payload URL as `https://api.paysdoc.nl/webhook`. The live hook configured on target repos points at `https://adw.paysdoc.nl/webhook` (verified against the paysdoc.nl repo's hook config on 2026-07-30).\n\nUpdate the README to the actual URL so operator docs match the deployed tunnel hostname.\n\n## Relevant files\n\n- `adws/README.md` — trigger_webhook.ts section, \"GitHub webhook settings\"\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-07-30T11:31:47Z","comments":[],"actionableComment":null}`

## Chore Description

`adws/README.md`, in the `#### trigger_webhook.ts - Real-time Events` → **Configuration** → *GitHub webhook settings* bullet list, documents the GitHub webhook **Payload URL** incorrectly. On `origin/dev` the line reads:

```
  - Payload URL: `https://api.paysdoc.nl/webhook`
```

The live GitHub webhook configured on target repos points at `https://adw.paysdoc.nl/webhook` (verified against the `paysdoc.nl` repo's hook config on 2026-07-30). This is corroborated in-repo by `adws/triggers/cloudflareTunnel.tsx:22`, whose `DEFAULT_TUNNEL_HOSTNAME` constant is `'adw.paysdoc.nl'` — the tunnel script that publishes the local webhook server has always defaulted to the `adw.` hostname, so `api.paysdoc.nl` in the README has been stale operator documentation.

The chore is a single-line documentation correction so operator docs match the deployed tunnel hostname.

**Pre-existing uncommitted working-tree state in this worktree — read before editing.** `git status` in this worktree is *not* clean at plan time. Three files carry uncommitted modifications that were present when the worktree was created; two of them are out of scope for this chore and one interacts directly with it:

1. `adws/README.md` — line 443 has **already** been changed away from `https://api.paysdoc.nl/webhook`, but to a generic placeholder `https://<your-host-or-tunnel-domain>/webhook`, **not** to the concrete URL this issue asks for. The implementation edits this line to the issue's requested value; no discard needed for this file.
2. `.claude/commands/adw_init.md` — a **-32/+ line revert of merged work**. The uncommitted diff deletes the entire step 7 ("Copy Starter Guardrails Settings", issue #763), renumbers steps 8→7 and 9→8, and strips the corresponding `## Agent Guardrails` report bullet. That step is present on `origin/dev` and on this branch's `HEAD`, and `.adw/conditional_docs.md` still lists `When modifying .claude/commands/adw_init.md step 7 (starter guardrails settings copy)` as an active condition for `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md`. This is an out-of-scope revert of merged work and **must be discarded, not committed**.
3. `README.md` — two additive lines documenting `adws/github/__tests__/workflowCommentsIssue.test.ts` and `adws/triggers/__tests__/promotionSweepDefaults.test.ts` in the directory tree. Both files exist on disk, so these are benign forward documentation — but they belong to whichever slice added those tests, not to this chore. Discard them so this chore's commit is a clean single-line change.

## Relevant Files

Use these files to resolve the chore:

- `adws/README.md` — **the file to change.** Line 443, inside the `#### trigger_webhook.ts - Real-time Events` → **Configuration** → `- GitHub webhook settings:` bullet list. This is the only occurrence of a documented Payload URL anywhere outside `specs/`.
- `adws/triggers/cloudflareTunnel.tsx` — **read-only corroboration.** `DEFAULT_TUNNEL_HOSTNAME = 'adw.paysdoc.nl'` (line 22) and the usage banner (line 13) confirm `adw.paysdoc.nl` is the real deployed hostname. **Do not modify.**
- `.claude/commands/adw_init.md` — **do not modify; restore.** Carries the out-of-scope uncommitted revert of merged issue #763 work described above.
- `README.md` (repo root) — **do not modify; restore.** Carries out-of-scope uncommitted additive doc lines described above. Note: the root README does *not* document a webhook payload URL anywhere (verified by grep), so it needs no forward edit for this chore.
- `.adw/commands.md` — source of the validation commands used in the `Validation Commands` section.
- `.adw/coding_guidelines.md` — project coding guidelines. This chore touches Markdown only, so the TypeScript-specific rules do not bind, but the guidelines' documentation-accuracy spirit is the whole point of the change.
- `.adw/conditional_docs.md` — checked for this chore. No conditional doc is triggered by editing `adws/README.md`'s webhook section: the only matching entries are the generic `README.md` ("first understanding the project structure") and `adws/README.md` ("when you're operating in the `adws/` directory") entries, which point at the files themselves rather than at an `app_docs/` companion. The webhook-related `app_docs/` entries (`feature-wqzfqj-ensure-cron-before-webhook-gates.md`, `feature-n96c4j-webhook-ensure-cron-on-every-event.md`, `feature-7fy9ry-simplify-webhook-handlers.md`) are all conditioned on modifying `trigger_webhook.ts` / `webhookHandlers.ts` / `webhookGatekeeper.ts` **code**, none of which this chore touches. **No additional documentation needs to be read or written.**

### New Files

None. This chore creates no files. It is documentation-only, so it also adds no BDD scenarios, no step definitions, and no unit tests — there is no runtime behaviour to assert.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Inspect the worktree's uncommitted state before touching anything

- Run `git status --short` and `git diff --stat`. Expect exactly three modified files: `.claude/commands/adw_init.md`, `README.md`, `adws/README.md`.
- Run `git diff .claude/commands/adw_init.md` and confirm it deletes the `7. **Copy Starter Guardrails Settings**` block and renumbers the following steps. If the diff is *not* what this plan describes, stop and report the discrepancy instead of blindly discarding.
- Run `git diff README.md` and confirm it is limited to the two additive tree lines (`workflowCommentsIssue.test.ts`, `promotionSweepDefaults.test.ts`).
- Confirm `HEAD` is clean of these changes — i.e. the reverts live in the **working tree only**, not in a commit — with `git diff HEAD --numstat -- .claude/commands/adw_init.md README.md`. Both files must appear (working-tree-only change). If either file's revert is already committed, do **not** attempt to amend; restore it in a commit on top instead, and say so in the report.

### 2. Discard the out-of-scope working-tree changes

- Restore the two out-of-scope files from `HEAD`:
  ```bash
  git checkout HEAD -- .claude/commands/adw_init.md README.md
  ```
- Do **not** use `git add -A`, `git stash`, or `git checkout .` — those would also wipe the in-scope `adws/README.md` change and (for `git add -A`) risk staging the revert.
- Verify the restore: `git diff --stat` must now show only `adws/README.md` as modified, and `grep -c 'Copy Starter Guardrails Settings' .claude/commands/adw_init.md` must return `1`.

### 3. Correct the payload URL in `adws/README.md`

- Edit `adws/README.md` line 443, inside the `- GitHub webhook settings:` bullet list under `#### trigger_webhook.ts - Real-time Events`.
- Change:
  ```md
  - Payload URL: `https://<your-host-or-tunnel-domain>/webhook`
  ```
  to:
  ```md
  - Payload URL: `https://adw.paysdoc.nl/webhook`
  ```
- Preserve the surrounding bullets (`Content type: application/json`, `Events: issues, issue_comment, ...`) byte-for-byte. Preserve the two-space indentation and the backtick code formatting. Change nothing else in the file.
- Note for the implementer: the working-tree starting text is the `<your-host-or-tunnel-domain>` placeholder, **not** the `api.paysdoc.nl` value quoted in the issue. Match on the placeholder text when editing. `origin/dev` still holds `api.paysdoc.nl`, so the net diff against `dev` will read as `api.paysdoc.nl` → `adw.paysdoc.nl`, which is exactly what the issue requests.

### 4. Verify the change and confirm no stale URL remains

- Confirm the new line is present:
  ```bash
  grep -n 'Payload URL' adws/README.md
  ```
  Must output exactly one line: ``  - Payload URL: `https://adw.paysdoc.nl/webhook` ``
- Confirm no stale hostname survives outside historical spec documents:
  ```bash
  grep -rn 'api.paysdoc.nl' --include='*.md' . | grep -v node_modules | grep -v '^./specs/'
  ```
  Must return no results. (`specs/issue-64-adw-permanent-webhook-ur-zqsq62-sdlc_planner-webhook-signature-and-portfolio.md` legitimately retains `api.paysdoc.nl` as the historical record of that slice's decision — **do not edit historical spec files.**)
- Confirm the diff against `origin/dev` is exactly one changed line in one file:
  ```bash
  git diff origin/dev --stat
  ```
  Expect `adws/README.md | 2 +-` and nothing else (a `specs/` entry for this plan file is also expected once the plan is committed).

### 5. Run the validation commands

- Execute every command in `Validation Commands` below, in order, and confirm each exits zero with no new failures. These are regression guards only — a Markdown-only change cannot break them, so any failure indicates pre-existing breakage or an unintended edit, and must be reported rather than worked around.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `grep -n 'Payload URL' adws/README.md` — must print exactly one line, containing `https://adw.paysdoc.nl/webhook`.
- `grep -rn 'api.paysdoc.nl' --include='*.md' . | grep -v node_modules | grep -v '^./specs/'` — must return no output (exit 1 from the final grep is the expected/passing outcome).
- `grep -c 'Copy Starter Guardrails Settings' .claude/commands/adw_init.md` — must print `1`, proving the out-of-scope revert of merged issue #763 work was discarded and not committed.
- `git diff origin/dev --stat -- .claude/commands/adw_init.md README.md` — must return no output, proving neither out-of-scope file diverges from `dev`.
- `bun run lint` — linter passes with no new errors.
- `bunx tsc --noEmit` — type check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-scoped type check passes.
- `bun run test:unit` — unit test suite passes with zero regressions.
- `bun run build` — build succeeds with no errors.

## Notes

- **Coding guidelines.** `.adw/coding_guidelines.md` exists and applies. This chore changes Markdown only, so the TypeScript, React, and nesting rules have no surface here; no refactoring is warranted. Resist any temptation to "tidy" adjacent README prose — the requested scope is one line.
- **No BDD scenario, no unit test.** Per `.adw/coding_guidelines.md`, BDD scenarios are ADW's validation mechanism, but a documentation string has no runtime behaviour to drive. Adding a test that greps a README would assert the README against itself. The grep assertions in `Validation Commands` serve as the proof.
- **Why `adw.paysdoc.nl` and not the placeholder.** The working tree already contained an unattributed edit to a generic `https://<your-host-or-tunnel-domain>/webhook` placeholder. A placeholder is arguably more portable for third-party operators, but issue #778 explicitly asks for the concrete deployed hostname so operator docs match reality, and `adws/triggers/cloudflareTunnel.tsx:22` already hardcodes `adw.paysdoc.nl` as the tunnel default — so the concrete value is consistent with the code, not merely with one deployment. Implement the issue as written. If the reviewer prefers the placeholder, that is a follow-up issue, not a scope change here.
- **Recurring "worktree born with a reversion" pattern.** The `.claude/commands/adw_init.md` revert in this worktree is a known recurring failure mode in this repo (roughly the tenth occurrence). Step 2 is not optional housekeeping — committing it would silently un-ship merged issue #763 work and desynchronise `.adw/conditional_docs.md`, which still names step 7 as live. Because `adw_init.md` is a `hashInputs:` file, an edit to it also bumps `.adw-version` and fans a regeneration out to every registered target repo, so an accidental revert would propagate. Verify with the grep in `Validation Commands` before opening the PR.
- **Do not edit `specs/`.** Historical plan documents such as `specs/issue-64-adw-permanent-webhook-ur-zqsq62-sdlc_planner-webhook-signature-and-portfolio.md` record the `api.paysdoc.nl` decision as it stood at the time. They are an audit trail, not live documentation, and are correctly excluded from the stale-URL grep.
- **Nothing else references a payload URL.** The root `README.md` mentions the webhook trigger and the Cloudflare tunnel prerequisite but never documents a payload URL, and `adws/README.md` does not document `cloudflareTunnel.tsx` at all. `adws/README.md:443` is the single point of truth being corrected.
